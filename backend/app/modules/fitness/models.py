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
    "cardio",
    "calves",
    "forearms",
)
# What a timed exercise records beside its time: walking or running speed,
# or added weight (a weighted plank). None: time alone.
TIME_TRACKS = ("speed", "weight")
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
        CheckConstraint(
            "track IS NULL OR track IN ('speed', 'weight')", name="ck_exercise_track"
        ),
    )

    name: str = Field(max_length=80)
    equipment: str = Field(sa_type=String(12))  # type: ignore
    muscle: str = Field(sa_type=String(12))  # type: ignore
    load_type: str = Field(default="weight", sa_type=String(12))  # type: ignore
    rep_min: int = 8
    rep_max: int = 12
    increment: float = Field(default=2.5, sa_type=Float)
    archived: bool = False
    track: str | None = Field(default=None, sa_type=String(8))  # type: ignore


class WorkoutTemplate(OwnedRow, table=True):
    __tablename__ = "workout_template"

    name: str = Field(max_length=80)
    sort_order: int = 0


class TemplateItem(OwnedRow, table=True):
    __tablename__ = "template_item"
    __table_args__ = (
        UniqueConstraint("template_id", "position", name="uq_template_item_pos"),
        CheckConstraint("sets BETWEEN 1 AND 20", name="ck_template_item_sets"),
        CheckConstraint(
            "target_sec IS NULL OR target_sec BETWEEN 1 AND 86400",
            name="ck_template_item_target",
        ),
    )

    template_id: uuid.UUID = Field(
        foreign_key="workout_template.id", ondelete="CASCADE", index=True
    )
    exercise_id: uuid.UUID = Field(foreign_key="exercise.id", ondelete="CASCADE")
    position: int
    sets: int = 3
    # A timed exercise's goal, in seconds (e.g. 1200: walk 20 minutes).
    target_sec: int | None = None


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
        CheckConstraint(
            "duration_sec IS NULL OR duration_sec BETWEEN 0 AND 86400",
            name="ck_workout_set_duration",
        ),
        CheckConstraint(
            "speed_kmh IS NULL OR (speed_kmh >= 0 AND speed_kmh <= 60)",
            name="ck_workout_set_speed",
        ),
        CheckConstraint(
            "unit IS NULL OR unit IN ('kg', 'lb')", name="ck_workout_set_unit"
        ),
    )

    workout_exercise_id: uuid.UUID = Field(
        foreign_key="workout_exercise.id", ondelete="CASCADE", index=True
    )
    position: int
    reps: int = 0
    weight: float = Field(default=0, sa_type=Float)
    kind: str = Field(default="working", sa_type=String(8))  # type: ignore
    # A timed set: how long, and how fast (walking or running).
    duration_sec: int | None = None
    speed_kmh: float | None = Field(default=None, sa_type=Float)
    # The unit this set's weight was entered and is shown in; the weight
    # itself is always kilograms. None: the person's settings unit.
    unit: str | None = Field(default=None, sa_type=String(2))  # type: ignore
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
        CheckConstraint(
            "(sat_fat_max_g IS NULL OR sat_fat_max_g >= 0)"
            " AND (sugar_max_g IS NULL OR sugar_max_g >= 0)"
            " AND (sodium_max_mg IS NULL OR sodium_max_mg >= 0)"
            " AND (fiber_g IS NULL OR fiber_g >= 0)",
            name="ck_macro_target_limits_nonneg",
        ),
    )

    effective_from: date
    kcal: float = Field(sa_type=Float)
    protein: float = Field(sa_type=Float)
    carbs: float = Field(sa_type=Float)
    fat: float = Field(sa_type=Float)
    # Daily limits to stay under (saturated fat and sugar in grams, sodium in
    # mg) and the fiber goal in grams. NULL means the WHO default.
    sat_fat_max_g: float | None = Field(default=None, sa_type=Float)
    sugar_max_g: float | None = Field(default=None, sa_type=Float)
    sodium_max_mg: float | None = Field(default=None, sa_type=Float)
    fiber_g: float | None = Field(default=None, sa_type=Float)


class TargetAdjustment(OwnedRow, table=True):
    """Burned kcal the user chose to add to one day's budget (eat-back from
    Apple Health). Applies to ``day`` only, unlike a versioned target."""

    __tablename__ = "target_adjustment"
    __table_args__ = (
        UniqueConstraint("owner_id", "day", name="uq_target_adjustment_day"),
        CheckConstraint("kcal >= 0", name="ck_target_adjustment_nonneg"),
    )

    day: date
    kcal: float = Field(sa_type=Float)
    source: str = Field(default="health", sa_type=String(8))  # type: ignore


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
        enum_check("sex", ("male", "female"), name="ck_fitness_sex"),
        enum_check(
            "activity_level",
            ("sedentary", "light", "moderate", "active", "very_active"),
            name="ck_fitness_activity",
        ),
        enum_check(
            "plan_goal",
            ("lose", "maintain", "recomp", "build"),
            name="ck_fitness_plan_goal",
        ),
        CheckConstraint(
            "height_cm IS NULL OR height_cm BETWEEN 100 AND 250",
            name="ck_fitness_height",
        ),
        CheckConstraint(
            "birth_year IS NULL OR birth_year >= 1900", name="ck_fitness_birth_year"
        ),
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
    # Profile for the formula-based daily plan; all optional.
    sex: str | None = Field(default=None, sa_type=String(6))  # type: ignore
    birth_year: int | None = None
    height_cm: float | None = Field(default=None, sa_type=Float)
    activity_level: str | None = Field(default=None, sa_type=String(11))  # type: ignore
    plan_goal: str | None = Field(default=None, sa_type=String(8))  # type: ignore


FOOD_BASES = ("100g", "piece", "serving")
FOOD_STATES = ("raw", "cooked", "as_sold")
FOOD_SOURCES = ("label", "brand", "philfct", "usda", "recipe", "said", "import")


class FoodItem(OwnedRow, table=True):
    """The person's own food library: one food's nutrition, as read from a
    label, said by them, or imported. Meal logging scales these values to the
    amount eaten before it falls back to an estimate, so the same food gives
    the same numbers every time.

    Values are per ``basis``: per 100 g, per piece or per serving
    (``unit_grams`` is the piece or serving weight, when known). Sugar is
    added sugar; sodium is in milligrams; every other amount is in grams."""

    __tablename__ = "food_item"
    __table_args__ = (
        UniqueConstraint("owner_id", "key", name="uq_food_item_owner_key"),
        enum_check("basis", FOOD_BASES, name="ck_food_item_basis"),
        enum_check("source", FOOD_SOURCES, name="ck_food_item_source"),
        CheckConstraint(
            "state IS NULL OR state IN ('raw', 'cooked', 'as_sold')",
            name="ck_food_item_state",
        ),
        CheckConstraint(
            "kcal >= 0 AND protein >= 0 AND carbs >= 0 AND fat >= 0",
            name="ck_food_item_nonneg",
        ),
        CheckConstraint(
            "(fiber IS NULL OR fiber >= 0) AND (sat_fat IS NULL OR sat_fat >= 0)"
            " AND (sugar IS NULL OR sugar >= 0) AND (sodium IS NULL OR sodium >= 0)",
            name="ck_food_item_detail_nonneg",
        ),
        CheckConstraint(
            "unit_grams IS NULL OR unit_grams > 0", name="ck_food_item_unit_grams"
        ),
    )

    name: str = Field(max_length=160)
    # The name folded for matching (lower case, plain words); one per owner.
    key: str = Field(max_length=160)
    # Other names it is called by ("sinangag", "garlic rice"), folded too.
    aliases: list[str] = Field(default_factory=list, sa_type=JSONB)
    basis: str = Field(default="100g", sa_type=String(8))  # type: ignore
    unit_grams: float | None = Field(default=None, sa_type=Float)
    state: str | None = Field(default=None, sa_type=String(8))  # type: ignore
    kcal: float = Field(sa_type=Float)
    protein: float = Field(default=0, sa_type=Float)
    carbs: float = Field(default=0, sa_type=Float)
    fat: float = Field(default=0, sa_type=Float)
    fiber: float | None = Field(default=None, sa_type=Float)
    sat_fat: float | None = Field(default=None, sa_type=Float)
    sugar: float | None = Field(default=None, sa_type=Float)
    sodium: float | None = Field(default=None, sa_type=Float)
    source: str = Field(default="said", sa_type=String(8))  # type: ignore
    source_url: str | None = Field(default=None, max_length=500)
    # Where an imported row came from (a Notion page URL), so a re-import
    # updates it instead of adding a second copy.
    external_ref: str | None = Field(default=None, max_length=200)
    notes: str | None = Field(default=None, max_length=500)
    verified: bool = False
    use_count: int = 0
    last_used_at: datetime | None = Field(default=None, sa_type=tstz())  # type: ignore
