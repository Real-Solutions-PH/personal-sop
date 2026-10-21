"""Read models for the habits screens. Nothing here writes: an unfinished run
from an earlier day is READ as abandoned (``logic.run_state``) and is only
written as abandoned by the next write that touches runs."""

import uuid
from datetime import date, timedelta
from typing import Literal
from zoneinfo import ZoneInfo

from sqlmodel import col

from app.modules.habits import logic as L
from app.modules.habits import services as svc
from app.modules.habits.models import HabitLog, HabitPause, Routine, RoutineRun
from app.modules.habits.schema import (
    ArchivedRow,
    BrokenOut,
    DayHabit,
    DayPublic,
    HabitDetail,
    HabitPublic,
    HabitRow,
    HabitsHome,
    LogPublic,
    MostMissedOut,
    OverallOut,
    PausePublic,
    PerHabit,
    PlayerState,
    RoutineDetail,
    RoutineHome,
    RoutinePublic,
    RoutineRow,
    RoutineStatsOut,
    RunPublic,
    RunSummary,
    SeriesDay,
    SortKey,
    StatsOut,
    StepDetail,
    StepResultPublic,
    StreaksOut,
    SummaryStep,
    TimerPublic,
    TimerState,
    TodayHabit,
    TodayPublic,
    TodayRoutine,
)
from app.modules.habits.views import World, habit_view, load_world, log_view
from app.shared import owned_repo
from app.shared.context import Ctx
from app.shared.domain import not_found


def stats_out(s: L.HabitStats) -> StatsOut:
    return StatsOut(
        scheduled=s.scheduled,
        done=s.done,
        partial=s.partial,
        skipped=s.skipped,
        missed=s.missed,
        bonus=s.bonus,
        minutes=s.minutes,
        count_total=s.count_total,
        rate=s.rate,
        skip_rate=s.skip_rate,
        on_time=s.on_time,
    )


def streaks_out(s: L.Streaks) -> StreaksOut:
    return StreaksOut(
        current=s.current,
        best=s.best,
        broken=[BrokenOut(day=b.day, length=b.length) for b in s.broken],
    )


def overall_out(s: L.OverallStats) -> OverallOut:
    return OverallOut(
        rate=s.rate,
        skip_rate=s.skip_rate,
        minutes=s.minutes,
        perfect=s.perfect,
        missed=s.missed,
        done=s.done,
    )


def routine_stats_out(s: L.RoutineStats) -> RoutineStatsOut:
    return RoutineStatsOut(
        scheduled_days=s.scheduled_days,
        completed=s.completed,
        abandoned=len(s.abandoned),
        rate=s.rate,
        pace=s.pace,
    )


def run_public(ctx: Ctx, run: RoutineRun, w: World | None = None) -> RunPublic:
    results = w.results.get(run.id, []) if w else svc.results_for(ctx, run.id)
    return RunPublic(
        id=run.id,
        routine_id=run.routine_id,
        day=run.day,
        started_at=run.started_at,
        ended_at=run.ended_at,
        steps=run.steps,
        results=[
            StepResultPublic.model_validate(r)
            for r in sorted(results, key=lambda r: r.position)
        ],
        current=run.current,
        step_started_at=run.step_started_at,
        step_paused_sec=run.step_paused_sec,
        step_bonus_sec=run.step_bonus_sec,
        paused_at=run.paused_at,
        state=L.run_state(
            L.RunView(id="", routine_id="", day=run.day, state=run.state), ctx.today
        ),
        version=run.version,
    )


def _zone(ctx: Ctx) -> ZoneInfo:
    return ctx.clock.zone


# ---------------------------------------------------------------- habits


def habit_list(
    ctx: Ctx,
    *,
    archived: bool = False,
    status: Literal["active", "paused"] | None = None,
    skip: int = 0,
    limit: int = 100,
) -> tuple[list[HabitRow], int]:
    """HAB-01: non-archived habits in manual order (``status`` filters by the
    effective status for the paused chip)."""
    w = load_world(ctx)
    today = ctx.today
    rows: list[HabitRow] = []
    for h in w.habits:
        v = w.views[h.id]
        eff = L.effective_status(v, today)
        if (eff == "archived") != archived:
            continue
        if status is not None and eff != status:
            continue
        rows.append(
            HabitRow(
                habit=HabitPublic.model_validate(h),
                effective_status=eff,
                last7=[
                    L.cell_for(v, today - timedelta(days=6 - i), w.idx, today)
                    for i in range(7)
                ],
                streak=L.streaks(v, w.idx, today).current,
                stats=stats_out(
                    L.habit_stats(
                        v,
                        w.idx,
                        today - timedelta(days=29),
                        today,
                        today,
                        zone=_zone(ctx),
                    )
                ),
            )
        )
    return rows[skip : skip + limit], len(rows)


def archived_list(
    ctx: Ctx, *, skip: int = 0, limit: int = 100
) -> tuple[list[ArchivedRow], int]:
    """HAB-08: archived habits with their date range and final stats."""
    w = load_world(ctx)
    today = ctx.today
    counts: dict[str, int] = {}
    for hid, _day in w.idx:
        counts[hid] = counts.get(hid, 0) + 1
    rows: list[ArchivedRow] = []
    for h in w.habits:
        v = w.views[h.id]
        if v.status != "archived":
            continue
        end = v.archived or today
        rows.append(
            ArchivedRow(
                habit=HabitPublic.model_validate(h),
                created_day=v.created,
                archived_day=v.archived,
                log_count=counts.get(v.id, 0),
                stats=stats_out(
                    L.habit_stats(v, w.idx, v.created, end, today, zone=_zone(ctx))
                ),
                best_streak=L.streaks(v, w.idx, today).best,
            )
        )
    rows.sort(key=lambda r: r.archived_day or today, reverse=True)
    return rows[skip : skip + limit], len(rows)


def habit_detail(ctx: Ctx, *, habit_id: uuid.UUID, days: int = 91) -> HabitDetail:
    """HAB-02: streaks, 30-day stats, a heatmap of ``days`` cells ending today
    and the recent logs."""
    h = svc.require_habit(ctx, habit_id)
    pauses = owned_repo.list_rows(
        ctx,
        HabitPause,
        col(HabitPause.habit_id) == h.id,
        order_by=(col(HabitPause.from_day),),
    )
    v = habit_view(ctx, h, pauses)
    logs = owned_repo.list_rows(
        ctx,
        HabitLog,
        col(HabitLog.habit_id) == h.id,
        order_by=(col(HabitLog.day).desc(),),
    )
    idx = L.log_index(log_view(lg) for lg in logs)
    today = ctx.today
    first = today - timedelta(days=days - 1)
    cur = L.current_pause(v, today)
    cur_row = next(
        (
            p
            for p in pauses
            if cur and p.from_day == cur.from_day and p.to_day == cur.to_day
        ),
        None,
    )
    return HabitDetail(
        habit=HabitPublic.model_validate(h),
        effective_status=L.effective_status(v, today),
        current_pause=PausePublic.model_validate(cur_row) if cur_row else None,
        pauses=[PausePublic.model_validate(p) for p in pauses],
        streaks=streaks_out(L.streaks(v, idx, today)),
        stats=stats_out(
            L.habit_stats(
                v, idx, today - timedelta(days=29), today, today, zone=_zone(ctx)
            )
        ),
        heat_first=first,
        heat=[L.cell_for(v, d, idx, today) for d in L.days_between(first, today)],
        recent_logs=[LogPublic.model_validate(lg) for lg in logs[:10]],
        log_count=len(logs),
    )


def habit_logs(
    ctx: Ctx, *, habit_id: uuid.UUID, skip: int, limit: int
) -> tuple[list[HabitLog], int]:
    svc.require_habit(ctx, habit_id)
    where = col(HabitLog.habit_id) == habit_id
    rows = owned_repo.list_rows(
        ctx,
        HabitLog,
        where,
        order_by=(col(HabitLog.day).desc(),),
        skip=skip,
        limit=limit,
    )
    return rows, owned_repo.count_rows(ctx, HabitLog, where)


def day_view(ctx: Ctx, *, day: date) -> DayPublic:
    """HAB-17: the day's scheduled habits (and any logged off-schedule) with
    their cell and log."""
    w = load_world(ctx)
    today = ctx.today
    logs = {
        (lg.habit_id, lg.day): lg
        for lg in owned_repo.list_rows(ctx, HabitLog, col(HabitLog.day) == day)
    }
    out: list[DayHabit] = []
    for h in w.habits:
        v = w.views[h.id]
        slot = L.slot_for(v.schedule, day)
        log = logs.get((h.id, day))
        if v.status == "archived" and log is None:
            continue
        if day < v.created and log is None:
            continue
        if slot is None and log is None:
            continue
        out.append(
            DayHabit(
                habit=HabitPublic.model_validate(h),
                cell=L.cell_for(v, day, w.idx, today),
                scheduled=slot is not None,
                time=slot.time if slot else None,
                log=LogPublic.model_validate(log) if log else None,
            )
        )
    out.sort(key=lambda d: (d.time or "99:99", d.habit.sort_order))
    return DayPublic(day=day, habits=out)


def today_view(ctx: Ctx) -> TodayPublic:
    """HAB-C1 / HAB-C2: today's due habits grouped Now / Later / Anytime /
    Done, the routine CTAs and the running timer."""
    w = load_world(ctx)
    today = ctx.today
    habits: list[TodayHabit] = []
    today_logs = {
        lg.habit_id: lg
        for lg in owned_repo.list_rows(ctx, HabitLog, col(HabitLog.day) == today)
    }
    due = done = 0
    for h in w.habits:
        v = w.views[h.id]
        if not L.is_due(v, today):
            continue
        lv = w.idx.get((v.id, today))
        if not (lv is not None and lv.status == "skipped"):
            due += 1
            if lv is not None and lv.status == "done":
                done += 1
        row = today_logs.get(h.id)
        slot = L.slot_for(v.schedule, today)
        habits.append(
            TodayHabit(
                habit=HabitPublic.model_validate(h),
                group=L.today_group(
                    v,
                    lv,
                    today,
                    ctx.now,
                    zone=_zone(ctx),
                    day_start_hour=ctx.clock.start_hour,
                ),
                time=slot.time if slot else None,
                log=LogPublic.model_validate(row) if row else None,
                streak=L.streaks(v, w.idx, today).current,
            )
        )
    routines: list[TodayRoutine] = []
    for r in w.routines:
        rv = w.routine_views[r.id]
        if r.status != "active" or today < rv.created:
            continue
        if L.slot_for(rv.schedule, today) is None:
            continue
        mine = [x for x in w.runs if x.routine_id == r.id and x.day == today]
        completed = next((x for x in mine if x.state == "completed"), None)
        running = next((x for x in mine if x.state == "in_progress"), None)
        run = completed or running
        state: Literal["start", "resume", "done"] = (
            "done" if completed else "resume" if running else "start"
        )
        routines.append(
            TodayRoutine(
                routine=RoutinePublic.model_validate(r),
                step_count=len(rv.steps),
                planned_min=L.planned_min(rv),
                state=state,
                run=run_public(ctx, run, w) if run else None,
            )
        )
    timer = svc.get_timer(ctx)
    return TodayPublic(
        day=today,
        habits=habits,
        routines=routines,
        due=due,
        done=done,
        timer=TimerPublic.model_validate(timer) if timer else None,
    )


def home(ctx: Ctx, *, days: int, sort: SortKey = "rate") -> HabitsHome:
    """HAB-16: the analytics screen for one period (``HabitsHome``)."""
    w = load_world(ctx)
    today = ctx.today
    zone = _zone(ctx)
    hs = L.sorted_habits(w.active_views())
    first = today - timedelta(days=days - 1)
    cur = L.overall_stats(w.habit_list(), w.idx, days, today, zone=zone)
    prev = L.overall_stats(w.habit_list(), w.idx, days, today, offset=days, zone=zone)
    by_id = {str(h.id): h for h in w.habits}
    per: list[PerHabit] = []
    for v in hs:
        s = L.habit_stats(v, w.idx, first, today, today, zone=zone)
        st = L.streaks(v, w.idx, today)
        per.append(
            PerHabit(
                habit=HabitPublic.model_validate(by_id[v.id]),
                stats=stats_out(s),
                streaks=streaks_out(st),
                broken=[
                    BrokenOut(day=b.day, length=b.length)
                    for b in st.broken
                    if b.day >= first
                ],
            )
        )
    series = L.overall_days(hs, w.idx, first, today, today)
    rolling: list[int] = []
    for i in range(len(series)):
        win = series[max(0, i - 6) : i + 1]
        d_due = sum(x.due for x in win)
        d_done = sum(x.done for x in win)
        rolling.append(L.js_round(d_done / d_due * 100) if d_due else 0)
    week_start = svc.get_settings(ctx).week_start
    heat_first = L.week_start_of(today - timedelta(days=90), week_start)
    heat_last = L.week_start_of(today, week_start) + timedelta(days=6)
    heat = [
        None if g.day > today else g.rate
        for g in L.overall_days(hs, w.idx, heat_first, heat_last, today)
    ]
    weekly: list[float] = []
    for i in range(8):
        end = today - timedelta(days=(7 - i) * 7)
        weekly.append(
            sum(
                L.habit_stats(
                    v, w.idx, end - timedelta(days=6), end, today, zone=zone
                ).minutes
                for v in hs
                if v.type == "duration"
            )
        )
    worst = L.most_missed_weekday(hs, w.idx, first, today)
    most_skipped = max(per, key=lambda p: p.stats.skipped, default=None)
    low = [p.habit.id for p in per if p.stats.scheduled >= 3 and p.stats.rate < 0.5]
    keyed = {
        "rate": lambda p: -p.stats.rate,
        "streak": lambda p: -p.streaks.current,
        "skip": lambda p: -p.stats.skip_rate,
        "name": lambda p: p.habit.name.lower(),
    }
    ranked = sorted(per, key=keyed[sort])
    run_views = list(w.run_views.values())
    runs_by_id = {x.id: x for x in w.runs}
    routines: list[RoutineHome] = []
    for r in w.routines:
        if r.status != "active":
            continue
        rs = L.routine_stats(w.routine_views[r.id], run_views, days, today)
        routines.append(
            RoutineHome(
                routine=RoutinePublic.model_validate(r),
                stats=routine_stats_out(rs),
                abandoned=[
                    run_public(ctx, runs_by_id[uuid.UUID(x.id)], w)
                    for x in rs.abandoned
                ],
            )
        )
    return HabitsHome(
        days=days,
        first=first,
        last=today,
        current=overall_out(cur),
        previous=overall_out(prev),
        ranked=ranked,
        series=[
            SeriesDay(day=d.day, due=d.due, done=d.done, rate=d.rate) for d in series
        ],
        rolling=rolling,
        heat=heat,
        heat_first=heat_first,
        weekly_minutes=weekly,
        most_missed=MostMissedOut(day=worst.day, count=worst.count) if worst else None,
        most_skipped=(
            most_skipped.habit.id
            if most_skipped is not None and most_skipped.stats.skipped > 0
            else None
        ),
        low=low,
        routines=routines,
    )


# ---------------------------------------------------------------- routines


def _step_details(w: World, steps: list[tuple[int, str, int]]) -> list[StepDetail]:
    by_id = {str(h.id): h for h in w.habits}
    out: list[StepDetail] = []
    for pos, hid, minutes in steps:
        h = by_id.get(hid)
        out.append(
            StepDetail(
                position=pos,
                habit_id=uuid.UUID(hid),
                name=h.name if h else "",
                icon=h.icon if h else "",
                minutes=minutes,
                archived=h is None or h.status == "archived",
            )
        )
    return out


def routine_list(
    ctx: Ctx, *, archived: bool = False, skip: int = 0, limit: int = 100
) -> tuple[list[RoutineRow], int]:
    """HAB-10: routines with steps, planned minutes, last run and 7-day dots
    (True completed, False scheduled and not completed, None unscheduled)."""
    w = load_world(ctx)
    today = ctx.today
    run_views = list(w.run_views.values())
    rows: list[RoutineRow] = []
    for r in w.routines:
        if (r.status == "archived") != archived:
            continue
        rv = w.routine_views[r.id]
        mine = sorted(
            (x for x in w.runs if x.routine_id == r.id), key=lambda x: x.started_at
        )
        last = mine[-1] if mine else None
        last7: list[bool | None] = []
        for i in range(7):
            d = today - timedelta(days=6 - i)
            if d < rv.created or L.slot_for(rv.schedule, d) is None:
                last7.append(None)
            else:
                last7.append(any(x.day == d and x.state == "completed" for x in mine))
        rows.append(
            RoutineRow(
                routine=RoutinePublic.model_validate(r),
                step_count=len(rv.steps),
                planned_min=L.planned_min(rv),
                last_run_state=(
                    L.run_state(w.run_views[last.id], today) if last else None
                ),
                last7=last7,
                stats=routine_stats_out(L.routine_stats(rv, run_views, 7, today)),
            )
        )
    return rows[skip : skip + limit], len(rows)


def routine_detail(ctx: Ctx, *, routine_id: uuid.UUID) -> RoutineDetail:
    """HAB-11: the step stack, last 7 runs and the 30-day stats."""
    r = svc.require_routine(ctx, routine_id)
    w = load_world(ctx)
    rv = w.routine_views[r.id]
    steps = _step_details(
        w, [(s.position, str(s.habit_id), s.minutes) for s in w.steps.get(r.id, [])]
    )
    mine = sorted(
        (x for x in w.runs if x.routine_id == r.id),
        key=lambda x: x.started_at,
        reverse=True,
    )
    active = svc.active_run(ctx, r.id)
    return RoutineDetail(
        routine=RoutinePublic.model_validate(r),
        steps=steps,
        planned_min=L.planned_min(rv),
        archived_steps=sum(1 for s in steps if s.archived),
        recent_runs=[run_public(ctx, x, w) for x in mine[:7]],
        stats=routine_stats_out(
            L.routine_stats(rv, list(w.run_views.values()), 30, ctx.today)
        ),
        active_run=run_public(ctx, active, w) if active else None,
    )


def player(ctx: Ctx, *, routine_id: uuid.UUID) -> PlayerState | None:
    """HAB-14: today's in-progress run of this routine, or None (start it)."""
    r = svc.require_routine(ctx, routine_id)
    run = svc.active_run(ctx, routine_id)
    if run is None:
        return None
    return player_state(ctx, r, run)


def player_state(ctx: Ctx, r: Routine, run: RoutineRun) -> PlayerState:
    w = load_world(ctx)
    steps = _step_details(
        w,
        [
            (i, str(s["habit_id"]), int(str(s["minutes"])))
            for i, s in enumerate(run.steps)
        ],
    )
    cur = steps[run.current] if run.current < len(steps) else None
    nxt = steps[run.current + 1] if run.current + 1 < len(steps) else None
    return PlayerState(
        run=run_public(ctx, run, w),
        routine=RoutinePublic.model_validate(r),
        current_step=cur,
        next_step=nxt,
        step_elapsed_sec=L.step_elapsed(
            run.step_started_at,
            ctx.now,
            paused_at=run.paused_at,
            step_paused_sec=run.step_paused_sec,
        ),
        step_planned_sec=(cur.minutes * 60 + run.step_bonus_sec) if cur else 0,
        total_actual_sec=sum(r.actual_sec for r in w.results.get(run.id, [])),
        planned_min=sum(s.minutes for s in steps),
    )


def run_summary(ctx: Ctx, *, run_id: uuid.UUID) -> RunSummary:
    """HAB-15: step outcomes, actual vs planned, streaks of the step habits
    and whether this was the fastest completed run in the last 30 days."""
    run = owned_repo.require(ctx, RoutineRun, run_id, what="routine_run")
    r = owned_repo.get(ctx, Routine, run.routine_id)
    if r is None:
        raise not_found("routine")
    w = load_world(ctx)
    today = ctx.today
    results = {x.position: x for x in w.results.get(run.id, [])}
    steps: list[SummaryStep] = []
    by_id = {str(h.id): h for h in w.habits}
    for i, s in enumerate(run.steps):
        hid = str(s["habit_id"])
        h = by_id.get(hid)
        res = results.get(i)
        v = w.views.get(uuid.UUID(hid))
        steps.append(
            SummaryStep(
                position=i,
                habit_id=uuid.UUID(hid),
                name=h.name if h else "",
                icon=h.icon if h else "",
                status=res.status if res else "not_reached",
                actual_sec=res.actual_sec if res else 0,
                planned_sec=int(str(s["minutes"])) * 60,
                streak=L.streaks(v, w.idx, today).current if v else 0,
            )
        )
    actual = sum(x.actual_sec for x in steps)
    state = L.run_state(w.run_views[run.id], today)
    month = [
        x
        for x in w.runs
        if x.routine_id == run.routine_id
        and x.day >= today - timedelta(days=29)
        and L.run_state(w.run_views[x.id], today) == "completed"
    ]
    fastest = (
        state == "completed"
        and len(month) > 1
        and all(
            actual <= L.run_actual_sec(w.run_views[x.id])
            for x in month
            if x.id != run.id
        )
    )
    return RunSummary(
        run=run_public(ctx, run, w),
        routine=RoutinePublic.model_validate(r),
        state=state,
        steps=steps,
        actual_sec=actual,
        planned_sec=sum(x.planned_sec for x in steps),
        fastest_this_month=fastest,
    )


def timer_state(ctx: Ctx) -> TimerState:
    t = svc.get_timer(ctx)
    return TimerState(
        timer=TimerPublic.model_validate(t) if t else None,
        elapsed_sec=svc.timer_elapsed(ctx, t) if t else 0.0,
    )
