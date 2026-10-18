"""Cross-module contract of the fitness module (implemented by fitness)."""

import uuid
from dataclasses import dataclass, field
from datetime import datetime
from typing import Literal

from app.modules.fitness.models import Exercise, Meal, WeighIn, Workout
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
    raise NotImplementedError


def find_or_create_exercise(ctx: Ctx, name: str) -> Exercise:
    raise NotImplementedError


def log_weigh_in(
    ctx: Ctx,
    *,
    kg: float,
    at: datetime | None = None,
    weigh_in_id: uuid.UUID | None = None,
) -> WeighIn:
    raise NotImplementedError


def log_meal(ctx: Ctx, draft: MealDraft) -> Meal:
    raise NotImplementedError


def estimate_meal_text(ctx: Ctx, text: str) -> MealDraft:
    """Deterministic estimate from the built-in food table (the fallback when
    no AI model resolves)."""
    raise NotImplementedError


def delete_workout(ctx: Ctx, *, workout_id: uuid.UUID) -> None:
    raise NotImplementedError


def delete_weigh_in(ctx: Ctx, *, weigh_in_id: uuid.UUID) -> None:
    raise NotImplementedError


def delete_meal(ctx: Ctx, *, meal_id: uuid.UUID) -> None:
    raise NotImplementedError


def latest_weight_kg(ctx: Ctx) -> float | None:
    raise NotImplementedError
