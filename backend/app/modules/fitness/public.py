"""Cross-module contract of the fitness module (implemented by fitness).

None of these commit: the calling use case does (see ``app.shared.context``).
"""

import uuid
from dataclasses import dataclass, field
from datetime import datetime
from typing import Literal

from app.modules.fitness import calc as C
from app.modules.fitness import foods as F
from app.modules.fitness import repo, services
from app.modules.fitness.models import Exercise, Meal, WeighIn, Workout
from app.modules.media import public as media_public
from app.modules.profile import public as profile_public
from app.shared import owned_repo
from app.shared.context import Ctx


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


def log_workout_from_chat(ctx: Ctx, draft: WorkoutDraft) -> Workout:
    """A finished workout from a capture; creates unknown exercises and runs
    the same finish path as the live logger (habit auto-check included)."""
    return services.log_workout_from_chat(
        ctx,
        name=draft.name,
        exercises=[
            (e.exercise, [(s.reps, s.weight) for s in e.sets]) for e in draft.exercises
        ],
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
    weigh_in_id: uuid.UUID | None = None,
) -> WeighIn:
    return services._weigh_in(ctx, kg=kg, at=at, weigh_in_id=weigh_in_id)


def _item(d: MealItemDraft) -> F.ItemDraft:
    return F.ItemDraft(
        d.name, d.qty, d.unit, d.kcal, d.protein, d.carbs, d.fat, d.assumption
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


def latest_weight_kg(ctx: Ctx) -> float | None:
    """The most recent weigh-in, in kilograms."""
    latest = repo.latest_weigh_in(ctx)
    return latest.weight_kg if latest else None
