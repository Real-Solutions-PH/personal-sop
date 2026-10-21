"""Read models behind the fitness screens. Pure reads: nothing here writes.

Each builder takes the :class:`~app.modules.fitness.calc.FitState` snapshot
the screen's numbers come from, so one request loads the user's rows once.
"""

import uuid
from datetime import date, timedelta

from sqlmodel import col

from app.modules.fitness import calc as C
from app.modules.fitness import repo
from app.modules.fitness import schema as S
from app.modules.fitness.models import (
    Exercise,
    MacroTarget,
    Meal,
    MealItem,
    Workout,
    WorkoutTemplate,
)
from app.shared import owned_repo
from app.shared.context import Ctx


def _uuid(s: str) -> uuid.UUID:
    return uuid.UUID(s)


def macros(m: C.Macros) -> S.MacrosOut:
    return S.MacrosOut(kcal=m.kcal, protein=m.protein, carbs=m.carbs, fat=m.fat)


def pr_out(p: C.Pr) -> S.PrOut:
    return S.PrOut(
        workout_id=_uuid(p.workout_id),
        exercise_id=_uuid(p.exercise_id),
        kind=p.kind,
        label=C.PR_LABEL[p.kind],
        value=p.value,
        prev=p.prev,
        at=p.at,
    )


def totals_out(t: C.Totals) -> S.TotalsOut:
    return S.TotalsOut(
        volume=t.volume, done=t.done, planned=t.planned, duration_sec=t.duration_sec
    )


def suggestion_out(x: C.Suggestion) -> S.SuggestionOut:
    return S.SuggestionOut(
        kind=x.kind,
        weight=x.weight,
        reps=x.reps,
        badge=x.badge,
        detail=x.detail,
        last_weight=x.last_weight,
        last_reps=x.last_reps,
    )


def trend_out(points: list[C.TrendPoint]) -> list[S.TrendPointOut]:
    return [S.TrendPointOut(day=p.day, raw=p.raw, avg=p.avg) for p in points]


def rate_out(r: C.WeeklyRate | None) -> S.WeeklyRateOut | None:
    return None if r is None else S.WeeklyRateOut(kg=r.kg, pct=r.pct, avg=r.avg)


def adherence_out(a: C.Adherence) -> S.AdherenceOut:
    return S.AdherenceOut(
        logged=a.logged,
        calorie=a.calorie,
        protein=a.protein,
        over_days=a.over_days,
        coverage=a.coverage,
    )


def period_out(p: C.PeriodSummary) -> S.PeriodOut:
    return S.PeriodOut(
        sessions=p.sessions,
        target=p.target,
        session_rate=p.session_rate,
        missed=p.missed,
        prs=p.prs,
        volume=p.volume,
    )


# --------------------------------------------------------------------------
# Workouts
# --------------------------------------------------------------------------


def _snapshot_of(state: C.FitState, w: Workout) -> C.WorkoutS | None:
    return next((x for x in state.workouts if x.id == str(w.id)), None)


def workout_prs(state: C.FitState, ws: C.WorkoutS) -> list[C.Pr]:
    """PRs a workout set (for one in progress: what it would set now)."""
    extra = ws if ws.status != "finished" else None
    return [p for p in C.all_prs(state, extra) if p.workout_id == ws.id]


def workout_out(ctx: Ctx, w: Workout, state: C.FitState | None = None) -> S.WorkoutOut:
    state = state or repo.load_state(ctx, meals=False)
    names = {e.id: e.name for e in state.exercises}
    # A tombstoned exercise still names the lifts logged with it.
    wes = repo.workout_exercises(ctx, w.id)
    sets = repo.sets_of(ctx, [we.id for we in wes])
    missing = {we.exercise_id for we in wes if str(we.exercise_id) not in names}
    for ex_id in missing:
        ex = owned_repo.get(ctx, Exercise, ex_id, include_deleted=True)
        names[str(ex_id)] = ex.name if ex else ""
    ws = repo.workout_s(w, wes, sets)
    return S.WorkoutOut.model_validate(
        {
            **S.WorkoutPublic.model_validate(w).model_dump(),
            "exercises": [
                {
                    **S.WorkoutExercisePublic.model_validate(we).model_dump(),
                    "exercise_name": names.get(str(we.exercise_id), ""),
                    "sets": [S.SetOut.model_validate(s) for s in sets.get(we.id, [])],
                }
                for we in wes
            ],
            "totals": totals_out(C.workout_totals(state, ws, ctx.now)),
            "prs": [pr_out(p) for p in workout_prs(state, ws)],
        }
    )


def workout_summaries(
    ctx: Ctx,
    *,
    skip: int,
    limit: int,
    template_id: uuid.UUID | None = None,
    exercise_id: uuid.UUID | None = None,
    q: str | None = None,
) -> S.WorkoutsOut:
    """Finished workouts, newest first, with totals and PR counts."""
    state = repo.load_state(ctx, meals=False)
    by_workout = C.prs_by_workout(C.all_prs(state))
    names = {e.id: e.name.lower() for e in state.exercises}
    rows = list(reversed(C.finished(state)))
    if template_id is not None:
        rows = [w for w in rows if w.template_id == str(template_id)]
    if exercise_id is not None:
        rows = [
            w
            for w in rows
            if any(we.exercise_id == str(exercise_id) for we in w.exercises)
        ]
    if q:
        needle = q.lower()
        rows = [
            w
            for w in rows
            if needle in w.name.lower()
            or any(needle in names.get(we.exercise_id, "") for we in w.exercises)
        ]
    page = rows[skip : skip + limit]
    db = {
        r.id: r
        for r in owned_repo.list_rows(
            ctx, Workout, col(Workout.id).in_([_uuid(w.id) for w in page])
        )
    }
    data = [
        S.WorkoutSummary.model_validate(
            {
                **S.WorkoutPublic.model_validate(db[_uuid(w.id)]).model_dump(),
                "exercise_count": len(w.exercises),
                "totals": totals_out(C.workout_totals(state, w, ctx.now)),
                "pr_count": len(by_workout.get(w.id, [])),
            }
        )
        for w in page
    ]
    return S.WorkoutsOut(data=data, count=len(rows))


def summary_of(ctx: Ctx, state: C.FitState, ws: C.WorkoutS) -> S.WorkoutSummary:
    w = owned_repo.require(ctx, Workout, _uuid(ws.id), what="workout")
    return S.WorkoutSummary.model_validate(
        {
            **S.WorkoutPublic.model_validate(w).model_dump(),
            "exercise_count": len(ws.exercises),
            "totals": totals_out(C.workout_totals(state, ws, ctx.now)),
            "pr_count": len(workout_prs(state, ws)),
        }
    )


# --------------------------------------------------------------------------
# Exercises and templates
# --------------------------------------------------------------------------


def exercise_with_stats(
    state: C.FitState, ex: Exercise, today: date
) -> S.ExerciseWithStats:
    hist = C.exercise_history(state, str(ex.id))
    return S.ExerciseWithStats.model_validate(
        {
            **S.ExercisePublic.model_validate(ex).model_dump(),
            "last_done_at": hist[-1].workout.started_at if hist else None,
            "best_e1rm": max((h.stats.best_e1rm for h in hist), default=None),
            "suggestion": suggestion_out(C.suggestion(state, str(ex.id))),
            "stalled": C.is_stalled(state, hist, today),
        }
    )


def exercises(
    ctx: Ctx,
    *,
    skip: int,
    limit: int,
    q: str | None,
    muscle: str | None,
    include_archived: bool,
) -> S.ExercisesOut:
    state = repo.load_state(ctx, meals=False)
    rows = owned_repo.list_rows(ctx, Exercise, order_by=[col(Exercise.name)])
    if not include_archived:
        rows = [e for e in rows if not e.archived]
    if muscle:
        rows = [e for e in rows if e.muscle == muscle]
    if q:
        rows = [e for e in rows if q.lower() in e.name.lower()]
    page = rows[skip : skip + limit]
    return S.ExercisesOut(
        data=[exercise_with_stats(state, e, ctx.today) for e in page], count=len(rows)
    )


def exercise_detail(ctx: Ctx, ex: Exercise) -> S.ExerciseDetail:
    state = repo.load_state(ctx, meals=False)
    base = exercise_with_stats(state, ex, ctx.today)
    hist = C.exercise_history(state, str(ex.id))
    return S.ExerciseDetail.model_validate(
        {
            **base.model_dump(),
            "history": [
                S.HistoryPointOut(
                    workout_id=_uuid(h.workout.id),
                    started_at=h.workout.started_at,
                    best_e1rm=h.stats.best_e1rm,
                    heaviest=h.stats.heaviest,
                    volume=h.stats.volume,
                    done_sets=h.stats.done_sets,
                    top_reps=h.stats.top.reps if h.stats.top else None,
                    top_weight=h.stats.top.weight if h.stats.top else None,
                )
                for h in hist
            ],
            "prs": [pr_out(p) for p in C.all_prs(state) if p.exercise_id == str(ex.id)],
        }
    )


def template_out(
    ctx: Ctx, t: WorkoutTemplate, state: C.FitState | None = None
) -> S.TemplateOut:
    state = state or repo.load_state(ctx, meals=False)
    names = {e.id: e.name for e in state.exercises}
    last = C.last_of_template(state, str(t.id))
    return S.TemplateOut.model_validate(
        {
            **S.WorkoutTemplatePublic.model_validate(t).model_dump(),
            "items": [
                S.TemplateItemOut(
                    exercise_id=i.exercise_id,
                    exercise_name=names.get(str(i.exercise_id), ""),
                    sets=i.sets,
                )
                for i in repo.template_items(ctx, t.id)
            ],
            "last_used_at": last.started_at if last else None,
        }
    )


def templates(ctx: Ctx, *, skip: int, limit: int) -> S.TemplatesOut:
    state = repo.load_state(ctx, meals=False)
    rows = owned_repo.list_rows(
        ctx,
        WorkoutTemplate,
        order_by=[col(WorkoutTemplate.sort_order), col(WorkoutTemplate.created_at)],
    )
    return S.TemplatesOut(
        data=[template_out(ctx, t, state) for t in rows[skip : skip + limit]],
        count=len(rows),
    )


# --------------------------------------------------------------------------
# Meals and nutrition
# --------------------------------------------------------------------------


def meal_out(ctx: Ctx, m: Meal) -> S.MealOut:
    items = repo.meal_items(ctx, m.id)
    return meal_out_from(m, items)


def meal_out_from(m: Meal, items: list[MealItem]) -> S.MealOut:
    return S.MealOut.model_validate(
        {
            **S.MealPublic.model_validate(m).model_dump(),
            "items": [S.MealItemPublic.model_validate(i) for i in items],
            "totals": macros(C.sum_macros(repo.meal_s(m, items).items)),
        }
    )


def meals_on(ctx: Ctx, day: date) -> list[S.MealOut]:
    first, last = ctx.clock.window(day, day)
    rows = owned_repo.list_rows(
        ctx,
        Meal,
        col(Meal.eaten_at) >= first,
        col(Meal.eaten_at) < last,
        order_by=[col(Meal.eaten_at)],
    )
    items = repo.items_by_meal(ctx, [m.id for m in rows])
    return [meal_out_from(m, items[m.id]) for m in rows]


def target_public(state: C.FitState, ctx: Ctx, day: date) -> S.MacroTargetPublic | None:
    t = C.target_for(state, day)
    if t is None:
        return None
    row = owned_repo.require(ctx, MacroTarget, _uuid(t.id), what="macro_target")
    return S.MacroTargetPublic.model_validate(row)


def nutrition_day(ctx: Ctx, day: date) -> S.NutritionDayOut:
    state = repo.load_state(ctx)
    dt = C.day_totals(state, day)
    left = C.macros_left(state, day)
    return S.NutritionDayOut(
        day=day,
        totals=macros(dt.totals),
        target=target_public(state, ctx, day),
        left=macros(left) if left else None,
        pending=dt.pending,
        to_review=dt.to_review,
        meals=meals_on(ctx, day),
    )


def nutrition_history(ctx: Ctx, days: int, offset: int = 0) -> S.NutritionHistoryOut:
    state = repo.load_state(ctx)
    a = C.adherence(state, days, ctx.today, offset)
    return S.NutritionHistoryOut(
        days=[
            S.DayVerdictOut(
                day=d.day,
                totals=macros(d.totals),
                target=macros(d.target) if d.target else None,
                meals=d.meals,
                kcal_ok=d.kcal_ok,
                protein_hit=d.protein_hit,
                over=d.over,
                verdict=d.verdict,
            )
            for d in C.nutrition_days(state, days, ctx.today)
        ],
        adherence=adherence_out(a),
    )


def targets(ctx: Ctx) -> S.TargetsOut:
    rows = owned_repo.list_rows(
        ctx, MacroTarget, order_by=[col(MacroTarget.effective_from).desc()]
    )
    current = next((t for t in rows if t.effective_from <= ctx.today), None)
    return S.TargetsOut(
        current=S.MacroTargetPublic.model_validate(current) if current else None,
        history=[S.MacroTargetPublic.model_validate(t) for t in rows],
    )


# --------------------------------------------------------------------------
# Body
# --------------------------------------------------------------------------


def body(ctx: Ctx, days: int) -> S.BodyOut:
    state = repo.load_state(ctx, meals=False)
    latest = repo.latest_weigh_in(ctx)
    return S.BodyOut(
        latest=S.WeighInPublic.model_validate(latest) if latest else None,
        trend=trend_out(C.weight_trend(state, days, ctx.today)),
        weekly_rate=rate_out(C.weekly_rate(state, ctx.today)),
        goal_direction=state.settings.goal_direction,
        goal_weight=state.settings.goal_weight,
    )


# --------------------------------------------------------------------------
# Stats, hub and share card
# --------------------------------------------------------------------------


def stats(ctx: Ctx, days: int) -> S.StatsOut:
    state = repo.load_state(ctx)
    today, now = ctx.today, ctx.now
    first = today - timedelta(days=days - 1)
    top: list[S.TopLiftOut] = []
    stalled: list[uuid.UUID] = []
    for ex in state.exercises:
        hist = C.exercise_history(state, ex.id)
        if not hist:
            continue
        is_stalled = C.is_stalled(state, hist, today)
        if is_stalled and not ex.archived:
            stalled.append(_uuid(ex.id))
        top.append(
            S.TopLiftOut(
                exercise_id=_uuid(ex.id),
                name=ex.name,
                best_e1rm=max(h.stats.best_e1rm for h in hist),
                first_e1rm=hist[0].stats.best_e1rm,
                stalled=is_stalled,
            )
        )
    top.sort(key=lambda t: -t.best_e1rm)
    weeks = max(1, (days + 6) // 7)
    return S.StatsOut(
        days=days,
        period=period_out(C.period_summary(state, days, today, now)),
        previous=period_out(C.period_summary(state, days, today, now, -days)),
        weeks=[
            S.WeekOut(start=w.start, count=w.count)
            for w in C.sessions_by_week(state, weeks, today)
        ],
        streak=C.consistency_streak(state, today),
        overload_rate=C.overload_rate(state, max(28, days), today),
        top_lifts=top[:10],
        stalled=stalled,
        prs=[pr_out(p) for p in C.all_prs(state) if first <= state.day(p.at) <= today],
        weight_trend=trend_out(C.weight_trend(state, days, today)),
        weekly_rate=rate_out(C.weekly_rate(state, today)),
        adherence=adherence_out(C.adherence(state, days, today)),
        area_rate=C.area_rate(state, days, today, now),
    )


def overview(ctx: Ctx) -> S.OverviewOut:
    state = repo.load_state(ctx)
    today = ctx.today
    active = repo.active_workout(ctx)
    nxt = C.next_template(state)
    done = C.finished(state)
    week = C.sessions_by_week(state, 1, today)[0]
    latest = repo.latest_weigh_in(ctx)
    dt = C.day_totals(state, today)
    left = C.macros_left(state, today)
    return S.OverviewOut(
        active=S.WorkoutPublic.model_validate(active) if active else None,
        next_template=template_out(
            ctx,
            owned_repo.require(ctx, WorkoutTemplate, _uuid(nxt.id), what="template"),
            state,
        )
        if nxt
        else None,
        last_workout=summary_of(ctx, state, done[-1]) if done else None,
        week=S.WeekOut(start=week.start, count=week.count),
        weekly_target=state.settings.weekly_target,
        streak=C.consistency_streak(state, today),
        latest_weight=S.WeighInPublic.model_validate(latest) if latest else None,
        weekly_rate=rate_out(C.weekly_rate(state, today)),
        macros_left=macros(left) if left else None,
        today_totals=macros(dt.totals),
        pending_meals=dt.pending,
        weighed_today=today in C.daily_weights(state),
    )


def share_card(
    ctx: Ctx, w: Workout, exercise_id: uuid.UUID | None = None
) -> S.ShareCardOut:
    """The numbers on the workout share card (``fitness-share.tsx``)."""
    state = repo.load_state(ctx)
    ws = _snapshot_of(state, w)
    if ws is None:
        ws = repo.workout_s(w, [], {})
    m = C.ex_map(state)
    bw = C.latest_bodyweight(state)
    prs = [p for p in C.all_prs(state) if p.workout_id == ws.id]
    lines = []
    for we in ws.exercises:
        st = C.ex_stats(we, m.get(we.exercise_id), bw or 0)
        ex = m.get(we.exercise_id)
        lines.append(
            S.ShareLineOut(
                exercise_id=_uuid(we.exercise_id),
                name=ex.name if ex else "",
                top_reps=st.top.reps if st.top else None,
                top_weight=st.top.weight if st.top else None,
                e1rm=st.best_e1rm,
            )
        )
    focus: str | None
    if exercise_id is not None:
        focus = str(exercise_id)
    else:
        e1 = next((p for p in prs if p.kind == "e1rm"), None)
        best = sorted(lines, key=lambda x: -x.e1rm)
        focus = e1.exercise_id if e1 else (str(best[0].exercise_id) if best else None)
    focus_pr = next(
        (p for p in prs if p.exercise_id == focus and p.kind == "e1rm"),
        next((p for p in prs if p.exercise_id == focus), None),
    )
    series = (
        [
            h.stats.best_e1rm
            for h in C.exercise_history(state, focus)
            if h.workout.started_at <= ws.started_at
        ]
        if focus
        else []
    )
    day = state.day(ws.started_at)
    week_start = C.week_start(day)
    week = next(
        (
            x.count
            for x in C.sessions_by_week(state, 20, ctx.today)
            if x.start == week_start
        ),
        1,
    )
    return S.ShareCardOut(
        workout=S.WorkoutPublic.model_validate(w),
        totals=totals_out(C.workout_totals(state, ws, ctx.now)),
        prs=[pr_out(p) for p in prs],
        lines=lines,
        focus_exercise_id=_uuid(focus) if focus else None,
        focus_pr=pr_out(focus_pr) if focus_pr else None,
        series=series,
        week_sessions=week,
        weekly_target=state.settings.weekly_target,
        streak=C.consistency_streak(state, ctx.today),
        bodyweight=bw,
        day_macros=macros(C.day_totals(state, day).totals),
    )
