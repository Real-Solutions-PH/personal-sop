"""Fitness: gym, body and nutrition (IA M3). Weights are kilograms."""

import uuid
from datetime import date, datetime

from sqlalchemy import CheckConstraint, Float, Index, String, UniqueConstraint, text
from sqlmodel import Field

from app.shared.owned import JSONB, OwnedRow, enum_check, tstz

EQUIPMENT = ("barbell", "dumbbell", "machine", "cable", "bodyweight")
LOAD_TYPES = ("weight", "bodyweight", "reps", "time")
MUSCLES = (
    "chest",
    "back",
    "shoulders",
    "biceps",
    "triceps",
    "quads",
    "hamstrings",
    "glutes",
    "core",
)
SET_KINDS = ("warmup", "working", "drop", "failure")
WORKOUT_STATUSES = ("in_progress", "finished", "discarded")
MEAL_LABELS = ("breakfast", "lunch", "dinner", "snack")
MEAL_SOURCES = ("photo", "voice", "text", "manual", "connector")
MEAL_STATUSES = ("pending_estimate", "estimated", "confirmed")


class Exercise(OwnedRow, table=True):
    __tablename__ = "exercise"
    __table_args__ = (
        enum_check("equipment", EQUIPMENT, name="ck_exercise_equipment"),
        enum_check("muscle", MUSCLES, name="ck_exercise_muscle"),
        enum_check("load_type", LOAD_TYPES, name="ck_exercise_load"),
        CheckConstraint("rep_min >= 1 AND rep_max >= rep_min", name="ck_exercise_reps"),
        CheckConstraint("increment >= 0", name="ck_exercise_increment"),
    )

    name: str = Field(max_length=80)
    equipment: str = Field(sa_type=String(12))  # type: ignore
    muscle: str = Field(sa_type=String(12))  # type: ignore
    load_type: str = Field(default="weight", sa_type=String(12))  # type: ignore
    rep_min: int = 8
    rep_max: int = 12
    increment: float = Field(default=2.5, sa_type=Float)
    archived: bool = False


class WorkoutTemplate(OwnedRow, table=True):
    __tablename__ = "workout_template"

    name: str = Field(max_length=80)
    sort_order: int = 0


class TemplateItem(OwnedRow, table=True):
    __tablename__ = "template_item"
    __table_args__ = (
        UniqueConstraint("template_id", "position", name="uq_template_item_pos"),
        CheckConstraint("sets BETWEEN 1 AND 20", name="ck_template_item_sets"),
    )

    template_id: uuid.UUID = Field(
        foreign_key="workout_template.id", ondelete="CASCADE", index=True
    )
    exercise_id: uuid.UUID = Field(foreign_key="exercise.id", ondelete="CASCADE")
    position: int
    sets: int = 3


class Workout(OwnedRow, table=True):
    """At most one ``in_progress`` workout per user (partial unique index in
    the migration)."""

    __tablename__ = "workout"
    __table_args__ = (
        Index(
            "uq_workout_one_active",
            "owner_id",
            unique=True,
            postgresql_where=text("status = 'in_progress' AND deleted_at IS NULL"),
        ),
        enum_check("status", WORKOUT_STATUSES, name="ck_workout_status"),
        enum_check("source", ("live", "chat"), name="ck_workout_source"),
    )

    name: str = Field(max_length=80)
    template_id: uuid.UUID | None = Field(
        default=None, foreign_key="workout_template.id", ondelete="SET NULL"
    )
    started_at: datetime = Field(sa_type=tstz(), index=True)  # type: ignore
    ended_at: datetime | None = Field(default=None, sa_type=tstz())  # type: ignore
    status: str = Field(default="in_progress", sa_type=String(12))  # type: ignore
    notes: str | None = Field(default=None, max_length=2000)
    source: str = Field(default="live", sa_type=String(5))  # type: ignore
    # Cardio logged with a chat workout: {activity, km?, min?}.
    cardio: dict[str, object] | None = Field(default=None, sa_type=JSONB)


class WorkoutExercise(OwnedRow, table=True):
    __tablename__ = "workout_exercise"
    __table_args__ = (
        UniqueConstraint("workout_id", "position", name="uq_workout_exercise_pos"),
    )

    workout_id: uuid.UUID = Field(
        foreign_key="workout.id", ondelete="CASCADE", index=True
    )
    exercise_id: uuid.UUID = Field(foreign_key="exercise.id", ondelete="RESTRICT")
    position: int
    note: str | None = Field(default=None, max_length=500)


class WorkoutSet(OwnedRow, table=True):
    __tablename__ = "workout_set"
    __table_args__ = (
        enum_check("kind", SET_KINDS, name="ck_workout_set_kind"),
        CheckConstraint("reps >= 0 AND reps <= 1000", name="ck_workout_set_reps"),
        CheckConstraint("weight >= 0 AND weight <= 2000", name="ck_workout_set_weight"),
    )

    workout_exercise_id: uuid.UUID = Field(
        foreign_key="workout_exercise.id", ondelete="CASCADE", index=True
    )
    position: int
    reps: int = 0
    weight: float = Field(default=0, sa_type=Float)
    kind: str = Field(default="working", sa_type=String(8))  # type: ignore
    completed_at: datetime | None = Field(default=None, sa_type=tstz())  # type: ignore


class RestTimer(OwnedRow, table=True):
    __tablename__ = "rest_timer"
    __table_args__ = (UniqueConstraint("owner_id", name="uq_rest_timer_owner"),)

    ends_at: datetime = Field(sa_type=tstz())  # type: ignore
    duration_sec: int


class WeighIn(OwnedRow, table=True):
    __tablename__ = "weigh_in"
    __table_args__ = (
        CheckConstraint("weight_kg > 0 AND weight_kg < 500", name="ck_weigh_in_weight"),
        CheckConstraint(
            "body_fat_pct IS NULL OR (body_fat_pct > 0 AND body_fat_pct < 100)",
            name="ck_weigh_in_bf",
        ),
    )

    measured_at: datetime = Field(sa_type=tstz(), index=True)  # type: ignore
    weight_kg: float = Field(sa_type=Float)
    body_fat_pct: float | None = Field(default=None, sa_type=Float)
    note: str | None = Field(default=None, max_length=280)


class MacroTarget(OwnedRow, table=True):
    """Targets are versioned by ``effective_from`` so history keeps the
    target that applied on each day."""

    __tablename__ = "macro_target"
    __table_args__ = (
        UniqueConstraint("owner_id", "effective_from", name="uq_macro_target_day"),
        CheckConstraint(
            "kcal >= 0 AND protein >= 0 AND carbs >= 0 AND fat >= 0",
            name="ck_macro_target_nonneg",
        ),
    )

    effective_from: date
    kcal: float = Field(sa_type=Float)
    protein: float = Field(sa_type=Float)
    carbs: float = Field(sa_type=Float)
    fat: float = Field(sa_type=Float)


class Meal(OwnedRow, table=True):
    __tablename__ = "meal"
    __table_args__ = (
        enum_check("label", MEAL_LABELS, name="ck_meal_label"),
        enum_check("source", MEAL_SOURCES, name="ck_meal_source"),
        enum_check("status", MEAL_STATUSES, name="ck_meal_status"),
        CheckConstraint(
            "confidence IS NULL OR (confidence >= 0 AND confidence <= 1)",
            name="ck_meal_confidence",
        ),
    )

    eaten_at: datetime = Field(sa_type=tstz(), index=True)  # type: ignore
    label: str = Field(sa_type=String(10))  # type: ignore
    source: str = Field(default="manual", sa_type=String(10))  # type: ignore
    photo_media_id: uuid.UUID | None = Field(
        default=None, foreign_key="media_object.id", ondelete="SET NULL"
    )
    raw_input: str = Field(default="", max_length=2000)
    status: str = Field(default="estimated", sa_type=String(16))  # type: ignore
    confidence: float | None = Field(default=None, sa_type=Float)
    # {question: str, options: [str]} while the estimate needs one answer.
    follow_up: dict[str, object] | None = Field(default=None, sa_type=JSONB)


class MealItem(OwnedRow, table=True):
    __tablename__ = "meal_item"
    __table_args__ = (
        CheckConstraint("qty > 0", name="ck_meal_item_qty"),
        CheckConstraint(
            "kcal >= 0 AND protein >= 0 AND carbs >= 0 AND fat >= 0",
            name="ck_meal_item_nonneg",
        ),
        CheckConstraint(
            "(fiber IS NULL OR fiber >= 0) AND (sat_fat IS NULL OR sat_fat >= 0)"
            " AND (sugar IS NULL OR sugar >= 0) AND (sodium IS NULL OR sodium >= 0)",
            name="ck_meal_item_detail_nonneg",
        ),
    )

    meal_id: uuid.UUID = Field(foreign_key="meal.id", ondelete="CASCADE", index=True)
    position: int = 0
    name: str = Field(max_length=120)
    qty: float = Field(sa_type=Float)
    unit: str = Field(max_length=24)
    kcal: float = Field(sa_type=Float)
    protein: float = Field(sa_type=Float)
    carbs: float = Field(sa_type=Float)
    fat: float = Field(sa_type=Float)
    assumption: str | None = Field(default=None, max_length=280)
    # Optional detail: fiber, saturated fat and sugar in grams; sodium in mg.
    fiber: float | None = Field(default=None, sa_type=Float)
    sat_fat: float | None = Field(default=None, sa_type=Float)
    sugar: float | None = Field(default=None, sa_type=Float)
    sodium: float | None = Field(default=None, sa_type=Float)


class FitnessSettings(OwnedRow, table=True):
    __tablename__ = "fitness_settings"
    __table_args__ = (
        UniqueConstraint("owner_id", name="uq_fitness_settings_owner"),
        enum_check("units", ("kg", "lb"), name="ck_fitness_units"),
        enum_check("progression", ("double", "linear"), name="ck_fitness_prog"),
        enum_check("ai_source", ("builtin", "connector"), name="ck_fitness_ai"),
        enum_check(
            "goal_direction", ("cut", "maintain", "bulk"), name="ck_fitness_goal"
        ),
        CheckConstraint("rest_sec BETWEEN 0 AND 900", name="ck_fitness_rest"),
        CheckConstraint("weekly_target BETWEEN 0 AND 14", name="ck_fitness_weekly"),
    )

    units: str = Field(default="kg", sa_type=String(2))  # type: ignore
    rest_sec: int = 120
    weekly_target: int = 4
    # Daily weigh-in reminder time (HH:MM, user clock); None = off.
    weigh_in_reminder: str | None = Field(default="06:30", max_length=5)
    progression: str = Field(default="double", sa_type=String(8))  # type: ignore
    ai_source: str = Field(default="builtin", sa_type=String(10))  # type: ignore
    goal_direction: str = Field(default="maintain", sa_type=String(8))  # type: ignore
    goal_weight: float | None = Field(default=None, sa_type=Float)
    setup_done: bool = False
