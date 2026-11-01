"""Cross-module contract of the fitness module (implemented by fitness).

None of these commit: the calling use case does (see ``app.shared.context``).
"""

import uuid
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from typing import Any, Literal

from sqlmodel import col

from app.modules.fitness import calc as C
from app.modules.fitness import calc as calc
from app.modules.fitness import catalog, repo, services
from app.modules.fitness import foods as F
from app.modules.fitness.models import (
    Exercise,
    FoodItem,
    Meal,
    MealItem,
    RunSession,
    WeighIn,
    Workout,
    WorkoutExercise,
    WorkoutSet,
    WorkoutTemplate,
)
from app.modules.media import public as media_public
from app.modules.profile import public as profile_public
from app.shared import owned_repo
from app.shared.context import Ctx

# ``calc`` is re-exported for read-only use: the deterministic Q&A computes
# over ``load_state`` with it.


@dataclass(frozen=True)
class SetDraft:
    reps: int
    weight: float


@dataclass(frozen=True)
class ExerciseDraft:
    exercise: str
    sets: list[SetDraft]


@dataclass(frozen=True)
class MealItemDraft:
    name: str
    qty: float
    unit: str
    kcal: float
    protein: float
    carbs: float
    fat: float
    assumption: str | None = None
    fiber: float | None = None
    sat_fat: float | None = None
    sugar: float | None = None
    sodium: float | None = None


@dataclass(frozen=True)
class MealDraft:
    raw: str
    items: list[MealItemDraft]
    confidence: float
    label: Literal["breakfast", "lunch", "dinner", "snack"] | None = None
    source: Literal["photo", "voice", "text", "manual", "connector"] = "text"
    photo_media_id: uuid.UUID | None = None
    eaten_at: datetime | None = None
    follow_up: dict[str, object] | None = None
    meal_id: uuid.UUID | None = None


@dataclass(frozen=True)
class WorkoutDraft:
    name: str
    exercises: list[ExerciseDraft] = field(default_factory=list)
    cardio: dict[str, object] | None = None
    workout_id: uuid.UUID | None = None
    day: date | None = None  # business day it happened on; None is today


def log_workout_from_chat(ctx: Ctx, draft: WorkoutDraft) -> Workout:
    """A finished workout from a capture; creates unknown exercises and runs
    the same finish path as the live logger (habit auto-check included)."""
    return services.log_workout_from_chat(
        ctx,
        name=draft.name,
        exercises=[
            (e.exercise, [(s.reps, s.weight) for s in e.sets]) for e in draft.exercises
        ],
        day=draft.day,
        workout_id=draft.workout_id,
        cardio=draft.cardio,
    )


def find_or_create_exercise(ctx: Ctx, name: str) -> Exercise:
    return services.find_or_create_exercise(ctx, name)


def log_weigh_in(
    ctx: Ctx,
    *,
    kg: float,
    at: datetime | None = None,
    body_fat_pct: float | None = None,
    weigh_in_id: uuid.UUID | None = None,
) -> WeighIn:
    return services._weigh_in(
        ctx, kg=kg, at=at, body_fat_pct=body_fat_pct, weigh_in_id=weigh_in_id
    )


def _item(d: MealItemDraft) -> F.ItemDraft:
    return F.ItemDraft(
        d.name,
        d.qty,
        d.unit,
        d.kcal,
        d.protein,
        d.carbs,
        d.fat,
        d.assumption,
        fiber=d.fiber,
        sat_fat=d.sat_fat,
        sugar=d.sugar,
        sodium=d.sodium,
    )


def log_meal(ctx: Ctx, draft: MealDraft) -> Meal:
    """A meal from a capture or the connector. Hand-entered and connector
    meals without an open question land ``confirmed``; everything an
    estimator produced waits in ``estimated`` for the user to confirm."""
    existing = services._existing_meal(ctx, draft.meal_id)
    if existing is not None:
        return existing
    if draft.photo_media_id is not None:
        media_public.require_ready(ctx, draft.photo_media_id)
    confirmed = draft.source in ("manual", "connector") and draft.follow_up is None
    meal = services._new_meal(
        ctx,
        eaten_at=draft.eaten_at,
        label=draft.label,
        source=draft.source,
        raw_input=draft.raw,
        status="confirmed" if confirmed else "estimated",
        confidence=max(0.0, min(1.0, draft.confidence)),
        follow_up=draft.follow_up,
        photo_media_id=draft.photo_media_id,
        meal_id=draft.meal_id,
    )
    services._append_items(ctx, meal, [_item(i) for i in draft.items])
    return meal


def apply_meal_estimate(
    ctx: Ctx,
    *,
    meal_id: uuid.UUID,
    items: list[MealItemDraft],
    confidence: float,
    follow_up: dict[str, object] | None = None,
) -> Meal:
    """Fill a queued photo meal (``pending_estimate``) or replace an
    estimate's items: the hook the capture pipeline calls once an AI model
    has read the photo. 409 ``meal_confirmed`` once the user confirmed it."""
    meal = owned_repo.require(ctx, Meal, meal_id, what="meal")
    return services.apply_estimate(
        ctx, meal, [_item(i) for i in items], confidence, follow_up
    )


def estimate_meal_text(ctx: Ctx, text: str) -> MealDraft:
    """Deterministic estimate from the built-in food table (the fallback when
    no AI model resolves). Nothing recognised: no items, confidence 0."""
    est = F.parse_meal_text(text)
    label = C.label_for_time(ctx.now, ctx.clock)
    if est is None:
        return MealDraft(raw=text, items=[], confidence=0, label=label)
    return MealDraft(
        raw=text,
        items=[
            MealItemDraft(
                name=i.name,
                qty=i.qty,
                unit=i.unit,
                kcal=i.kcal,
                protein=i.protein,
                carbs=i.carbs,
                fat=i.fat,
                assumption=i.assumption,
            )
            for i in est.items
        ],
        confidence=est.confidence,
        label=label,
        follow_up=est.follow_up.as_dict() if est.follow_up else None,
    )


def delete_workout(ctx: Ctx, *, workout_id: uuid.UUID) -> None:
    w = owned_repo.require(ctx, Workout, workout_id, what="workout")
    if w.status == "in_progress":
        w.status = "discarded"
        w.ended_at = ctx.now
        profile_public.end_live(ctx, kind="workout", ref_id=w.id)
        services._clear_rest(ctx)
    services._delete_workout(ctx, w)


def delete_weigh_in(ctx: Ctx, *, weigh_in_id: uuid.UUID) -> None:
    services._delete_weigh_in(ctx, weigh_in_id)


def delete_meal(ctx: Ctx, *, meal_id: uuid.UUID) -> None:
    services._delete_meal(ctx, meal_id)


def meal_exists(ctx: Ctx, meal_id: str | uuid.UUID) -> bool:
    """A meal of this person's that has not been deleted."""
    try:
        mid = uuid.UUID(str(meal_id))
    except ValueError:
        return False
    return owned_repo.get(ctx, Meal, mid) is not None


def latest_weight_kg(ctx: Ctx) -> float | None:
    """The most recent weigh-in, in kilograms."""
    latest = repo.latest_weigh_in(ctx)
    return latest.weight_kg if latest else None


def latest_weigh_in_day(ctx: Ctx) -> date | None:
    """The business day of the most recent weigh-in."""
    latest = repo.latest_weigh_in(ctx)
    return ctx.clock.day_of(latest.measured_at) if latest else None


# WHO guidance for a 2,000 kcal day, used where a target leaves a limit
# unset: saturated fat and free sugars under 10% of energy, sodium under
# 2,000 mg, and 25 g of fiber. The mobile app holds the same defaults.
DEFAULT_LIMITS: dict[str, float] = {
    "sat_fat_max_g": 20,
    "sugar_max_g": 50,
    "sodium_max_mg": 2000,
    "fiber_g": 25,
}


# The last local hour each main meal is still "ahead" (a 21:00 dinner
# is still to come at 20:30; lunch at 15:30 has passed).
MEAL_UNTIL = {"breakfast": 11, "lunch": 15, "dinner": 22}
_LIMIT_EATEN = {
    "sat_fat_max_g": "sat_fat_g",
    "sugar_max_g": "sugar_g",
    "sodium_max_mg": "sodium_mg",
}


def _plan_ahead(
    ctx: Ctx,
    counted: list[Meal],
    eaten: dict[str, Any],
    left: dict[str, float],
    target: dict[str, Any],
) -> dict[str, Any]:
    """What Fern plans the rest of the day with: the room left under each
    limit, the main meals still ahead (not logged, and not yet past their
    hour), the remainder split evenly across them, and foods the person has
    eaten lately, so suggestions fit both their numbers and their habits."""
    hour = ctx.now.astimezone(ctx.clock.zone).hour
    logged = {m.label for m in counted}
    ahead = [
        label
        for label, until in MEAL_UNTIL.items()
        if label not in logged and hour < until
    ]
    room = {
        k.replace("_max", "_left"): round(
            float(v) - float(eaten.get(_LIMIT_EATEN[k]) or 0), 1
        )
        for k, v in target.items()
        if k in _LIMIT_EATEN
    }
    out: dict[str, Any] = {"limits_left": room, "meals_ahead": ahead}
    if ahead:
        n = len(ahead)
        out["per_meal_ahead"] = {
            k: round(max(v, 0) / n, 1) for k, v in left.items()
        } | {k: round(max(v, 0) / n, 1) for k, v in room.items()}
    since = ctx.now - timedelta(days=14)
    recent = owned_repo.list_rows(
        ctx, Meal, col(Meal.eaten_at) >= since, order_by=[col(Meal.eaten_at).desc()]
    )
    names: list[str] = []
    for m in recent:
        for it in repo.meal_items(ctx, m.id):
            if it.name not in names:
                names.append(it.name)
        if len(names) >= 12:
            break
    out["recent_foods"] = names[:12]
    return out


def nutrition_today(ctx: Ctx) -> dict[str, Any]:
    """Today's intake against the target, for the companion's facts:
    eaten (macros plus fiber, saturated fat, sugar and sodium where the meals
    carry them), the target in force, what is left, meals logged, and the
    latest weigh-in. Meals still waiting for an estimate add nothing."""
    from sqlmodel import col

    day = ctx.today
    start, end = ctx.clock.window(day, day)
    meals = owned_repo.list_rows(
        ctx,
        Meal,
        col(Meal.eaten_at) >= start,
        col(Meal.eaten_at) < end,
    )
    counted = [m for m in meals if m.status != "pending_estimate"]
    items = [it for m in counted for it in repo.meal_items(ctx, m.id)]

    def total(key: str) -> float:
        return round(sum(float(getattr(i, key) or 0) for i in items), 1)

    def known(key: str) -> float | None:
        vals = [getattr(i, key) for i in items if getattr(i, key) is not None]
        return round(sum(vals), 1) if vals else None

    eaten: dict[str, Any] = {
        k: total(k) for k in ("kcal", "protein", "carbs", "fat")
    } | {
        k: v
        for k, v in {
            "fiber_g": known("fiber"),
            "sat_fat_g": known("sat_fat"),
            "sugar_g": known("sugar"),
            "sodium_mg": known("sodium"),
        }.items()
        if v is not None
    }
    state = repo.load_state(ctx, meals=False)
    t = C.budget_for(state, day)
    out: dict[str, Any] = {
        "meals_logged": len(counted),
        "meals_waiting_for_estimate": len(meals) - len(counted),
        "eaten": eaten,
    }
    if t is not None:
        target = {"kcal": t.kcal, "protein": t.protein, "carbs": t.carbs, "fat": t.fat}
        out["left"] = {k: round(v - eaten[k], 1) for k, v in target.items()}
        # Limits to stay under and the fiber goal: the user's own where set,
        # else the WHO default.
        out["target"] = target | {
            k: v if v is not None else DEFAULT_LIMITS[k]
            for k, v in {
                "sat_fat_max_g": t.sat_fat_max_g,
                "sugar_max_g": t.sugar_max_g,
                "sodium_max_mg": t.sodium_max_mg,
                "fiber_g": t.fiber_g,
            }.items()
        }
    if t is not None:
        out |= _plan_ahead(ctx, counted, eaten, out["left"], out["target"])
    latest = repo.latest_weigh_in(ctx)
    if latest is not None:
        out["latest_weigh_in"] = {
            "day": ctx.clock.day_of(latest.measured_at).isoformat(),
            "kg": latest.weight_kg,
            **(
                {"body_fat_pct": latest.body_fat_pct}
                if latest.body_fat_pct is not None
                else {}
            ),
        }
    return out


def macros_left(ctx: Ctx, *, day: date) -> C.Macros | None:
    """The day's target minus what was eaten (pending estimates excluded);
    None when no target is set."""
    return C.macros_left(repo.load_state(ctx), day)


def count_finished_workouts_since(ctx: Ctx, *, since: datetime) -> int:
    """Finished workouts started after ``since``."""
    return owned_repo.count_rows(
        ctx,
        Workout,
        col(Workout.status) == "finished",
        col(Workout.started_at) > since,
    )


def load_state(ctx: Ctx) -> C.FitState:
    """The user's whole fitness state: the input to every ``calc``
    calculation."""
    return repo.load_state(ctx)


def items_due_today(ctx: Ctx) -> list[tuple[str, bool]]:
    """Today's fitness ring items by name, as (item, done)."""
    from app.modules.fitness.stats import items_due

    return items_due(repo.load_state(ctx), ctx.today)


@dataclass(frozen=True)
class TemplateItemDraft:
    """One exercise of a template: its name, how many sets, and the reps a
    new exercise is given as its rep range (an existing one keeps its own)."""

    exercise: str
    sets: int = 3
    reps: int | None = None


def exercise_named(ctx: Ctx, name: str) -> Exercise | None:
    """A live, unmerged exercise with this name or alias (case-insensitive)."""
    return services.exercise_by_name(ctx, name)


def names_for_speech(ctx: Ctx, *, limit: int = 60) -> tuple[list[str], list[str]]:
    """(exercise names, food library names), most recently touched first:
    words speech to text should expect."""
    ex = owned_repo.list_rows(
        ctx, Exercise, order_by=[col(Exercise.updated_at).desc()], limit=limit
    )
    foods = owned_repo.list_rows(
        ctx, FoodItem, order_by=[col(FoodItem.updated_at).desc()], limit=limit
    )
    return [e.name for e in ex], [f.name for f in foods]


def create_template(
    ctx: Ctx,
    *,
    name: str,
    items: list[TemplateItemDraft],
    template_id: uuid.UUID | None = None,
) -> tuple[WorkoutTemplate, list[str]]:
    """A workout template, creating any exercise it names that does not
    exist yet. Returns the template and the names of the exercises made.

    Routines are a shared catalog: a routine already called ``name`` (or a
    close spelling of it) is returned as it is, and nothing is created."""
    existing = find_template(ctx, name)
    if existing is not None:
        return existing, []
    made: list[str] = []
    slots: list[tuple[uuid.UUID, int]] = []
    for it in items:
        ex = exercise_named(ctx, it.exercise)
        if ex is None:
            ex = services.find_or_create_exercise(ctx, it.exercise)
            if it.reps:
                ex.rep_min = ex.rep_max = it.reps
                ctx.session.add(ex)
            made.append(ex.name)
        slots.append((ex.id, it.sets))
    t = services._put_template(ctx, template_id or uuid.uuid4(), name, slots)
    ctx.session.flush()
    return t, made


def delete_template(ctx: Ctx, *, template_id: uuid.UUID) -> None:
    """Delete a template and its items (exercises stay in the library)."""
    services._delete_template(ctx, template_id)


def find_template(ctx: Ctx, name: str) -> WorkoutTemplate | None:
    """The catalog routine ``name`` means (same folded name, or one close
    spelling), oldest first."""
    rows = owned_repo.list_rows(
        ctx,
        WorkoutTemplate,
        order_by=[col(WorkoutTemplate.created_at), col(WorkoutTemplate.id)],
    )
    return catalog.resolve_routine(name, rows)


# ------------------------------------------------- edits from chat (Fern)


def restore_meal(ctx: Ctx, *, meal_id: uuid.UUID) -> None:
    m = owned_repo.require(ctx, Meal, meal_id, what="meal", include_deleted=True)
    owned_repo.restore(ctx, m)
    services._dirty_at(ctx, m.eaten_at)


def restore_weigh_in(ctx: Ctx, *, weigh_in_id: uuid.UUID) -> None:
    w = owned_repo.require(
        ctx, WeighIn, weigh_in_id, what="weigh_in", include_deleted=True
    )
    owned_repo.restore(ctx, w)
    services._dirty_at(ctx, w.measured_at)


def recent_meals(ctx: Ctx, *, days: int = 7) -> list[Meal]:
    """Meals eaten in the last ``days`` days, newest first."""
    return owned_repo.list_rows(
        ctx,
        Meal,
        col(Meal.eaten_at) >= ctx.now - timedelta(days=days),
        order_by=[col(Meal.eaten_at).desc()],
    )


def recent_weigh_ins(ctx: Ctx, *, days: int = 30) -> list[WeighIn]:
    return owned_repo.list_rows(
        ctx,
        WeighIn,
        col(WeighIn.measured_at) >= ctx.now - timedelta(days=days),
        order_by=[col(WeighIn.measured_at).desc()],
    )


# ------------------------------------------------- facts for Fern's reads


_NUTRIENTS = ("kcal", "protein", "carbs", "fat", "fiber", "sat_fat", "sugar", "sodium")


def meal_item_facts(ctx: Ctx, first: date, last: date) -> list[dict[str, Any]]:
    """One row per food eaten over the business days ``[first, last]``."""
    lo, hi = ctx.clock.window(first, last)
    meals = {
        m.id: m
        for m in owned_repo.list_rows(
            ctx, Meal, col(Meal.eaten_at) >= lo, col(Meal.eaten_at) < hi
        )
    }
    if not meals:
        return []
    items = owned_repo.list_rows(
        ctx,
        MealItem,
        col(MealItem.meal_id).in_(list(meals)),
        order_by=[col(MealItem.position)],
    )
    out = []
    for it in items:
        m = meals[it.meal_id]
        out.append(
            {
                "day": ctx.clock.day_of(m.eaten_at).isoformat(),
                "time": m.eaten_at.astimezone(ctx.clock.zone).strftime("%H:%M"),
                "meal": m.label,
                "food": it.name,
                "amount": f"{it.qty:g} {it.unit}",
                "assumed": it.assumption,
                "estimated": m.status != "confirmed",
                **{k: getattr(it, k) for k in _NUTRIENTS},
            }
        )
    return sorted(out, key=lambda r: (r["day"], r["time"]))


def workout_facts(ctx: Ctx, first: date, last: date) -> list[dict[str, Any]]:
    """One row per exercise of each finished workout in ``[first, last]``:
    its working sets, reps, top weight and volume (reps x weight)."""
    lo, hi = ctx.clock.window(first, last)
    workouts = {
        w.id: w
        for w in owned_repo.list_rows(
            ctx,
            Workout,
            col(Workout.started_at) >= lo,
            col(Workout.started_at) < hi,
            col(Workout.status) == "finished",
        )
    }
    if not workouts:
        return []
    names = {e.id: e.name for e in owned_repo.list_rows(ctx, Exercise)}
    wes = owned_repo.list_rows(
        ctx, WorkoutExercise, col(WorkoutExercise.workout_id).in_(list(workouts))
    )
    sets: dict[uuid.UUID, list[WorkoutSet]] = {}
    for st in owned_repo.list_rows(
        ctx,
        WorkoutSet,
        col(WorkoutSet.workout_exercise_id).in_([we.id for we in wes]),
    ):
        if st.kind != "warmup" and st.completed_at is not None:
            sets.setdefault(st.workout_exercise_id, []).append(st)
    out: list[dict[str, Any]] = []
    for we in wes:
        w, done = workouts[we.workout_id], sets.get(we.id, [])
        if w.cardio:
            # Chat cardio also saves a stand-in "Run" set (reps = minutes);
            # the cardio row below is the one record of it.
            continue
        mins = sum(st.duration_sec or 0 for st in done) / 60
        row: dict[str, Any] = {
            "day": ctx.clock.day_of(w.started_at).isoformat(),
            "workout": w.name,
            "exercise": names.get(we.exercise_id, ""),
            "sets": len(done),
            "reps": sum(st.reps for st in done),
            "volume_kg": sum(st.reps * st.weight for st in done),
        }
        top = max((st.weight for st in done), default=0)
        if top:
            row["top_kg"] = top
        if mins:
            row["minutes"] = round(mins, 1)
        out.append(row)
    # Cardio logged from chat is kept on the workout itself.
    for w in workouts.values():
        c = w.cardio or {}
        if c:
            row = {
                "day": ctx.clock.day_of(w.started_at).isoformat(),
                "workout": w.name,
                "exercise": str(c.get("activity") or "Cardio"),
            }
            for key, name in (("min", "minutes"), ("km", "km")):
                v = c.get(key)
                if isinstance(v, (int, float)):
                    row[name] = float(v)
            out.append(row)
    return sorted(out, key=lambda r: str(r["day"]))


def recent_run_sessions(
    ctx: Ctx, *, since: datetime, limit: int = 20
) -> list[dict[str, Any]]:
    """Run and walk sessions started at or after ``since``, newest first,
    without the route (it is long and the agent reads the splits)."""
    rows = owned_repo.list_rows(
        ctx,
        RunSession,
        col(RunSession.started_at) >= since,
        order_by=[col(RunSession.started_at).desc()],
        limit=limit,
    )
    return [
        {
            "kind": r.kind,
            "name": r.name,
            "started_at": r.started_at.isoformat(),
            "ended_at": r.ended_at.isoformat(),
            "moving_sec": r.moving_sec,
            "distance_m": r.distance_m,
            "elevation_gain_m": r.elevation_gain_m,
            "steps": r.steps,
            "avg_hr": r.avg_hr,
            "max_hr": r.max_hr,
            "kcal": r.kcal,
            "splits": r.splits,
        }
        for r in rows
    ]


def weigh_in_facts(ctx: Ctx, first: date, last: date) -> list[dict[str, Any]]:
    lo, hi = ctx.clock.window(first, last)
    return [
        {
            "day": ctx.clock.day_of(w.measured_at).isoformat(),
            "kg": w.weight_kg,
            "body_fat_pct": w.body_fat_pct,
        }
        for w in owned_repo.list_rows(
            ctx,
            WeighIn,
            col(WeighIn.measured_at) >= lo,
            col(WeighIn.measured_at) < hi,
            order_by=[col(WeighIn.measured_at)],
        )
    ]


# ------------------------------------------------- food library

# ------------------------------------------------- changes from chat (Fern)
from app.modules.fitness import chat as chat  # noqa: E402
from app.modules.fitness import food_library as food_library  # noqa: E402
from app.modules.fitness import nutrient_check as nutrient_check  # noqa: E402
from app.modules.fitness.food_library import FoodDraft as FoodDraft  # noqa: E402
