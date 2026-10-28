"""Request and response schemas of the fitness module. Weights are always
kilograms: ``units`` in the settings is a display preference only."""

import uuid
from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

Equipment = Literal["barbell", "dumbbell", "machine", "cable", "bodyweight"]
LoadType = Literal["weight", "bodyweight", "reps", "time"]
Muscle = Literal[
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
]
TimeTrack = Literal["speed", "weight"]
SetKind = Literal["warmup", "working", "drop", "failure"]
MealLabel = Literal["breakfast", "lunch", "dinner", "snack"]
MealSource = Literal["photo", "voice", "text", "manual", "connector"]
MealStatus = Literal["pending_estimate", "estimated", "confirmed"]
Units = Literal["kg", "lb"]
Progression = Literal["double", "linear"]
AiSource = Literal["builtin", "connector"]
GoalDirection = Literal["cut", "maintain", "bulk"]
Sex = Literal["male", "female"]
ActivityLevel = Literal["sedentary", "light", "moderate", "active", "very_active"]
PlanGoal = Literal["lose", "maintain", "recomp", "build"]

Macro = Field(ge=0, le=100000)
OptMacro = Field(default=None, ge=0, le=100000)
OptKg = Field(default=None, ge=0, le=2000)


class _Row(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    version: int
    updated_at: datetime


# --------------------------------------------------------------------------
# Rows (sync ``public`` schemas and REST building blocks)
# --------------------------------------------------------------------------


class ExercisePublic(_Row):
    name: str
    equipment: str
    muscle: str
    load_type: str
    rep_min: int
    rep_max: int
    increment: float
    archived: bool
    track: TimeTrack | None = None


class WorkoutTemplatePublic(_Row):
    name: str
    sort_order: int


class TemplateItemPublic(_Row):
    template_id: uuid.UUID
    exercise_id: uuid.UUID
    position: int
    sets: int
    target_sec: int | None = None


class WorkoutPublic(_Row):
    name: str
    template_id: uuid.UUID | None
    started_at: datetime
    ended_at: datetime | None
    status: str
    notes: str | None
    source: str
    cardio: dict[str, object] | None = None


class WorkoutExercisePublic(_Row):
    workout_id: uuid.UUID
    exercise_id: uuid.UUID
    position: int
    note: str | None


class WorkoutSetPublic(_Row):
    workout_exercise_id: uuid.UUID
    position: int
    reps: int
    weight: float
    kind: str
    completed_at: datetime | None
    duration_sec: int | None = None
    speed_kmh: float | None = None
    unit: Units | None = None


class RestTimerPublic(_Row):
    ends_at: datetime
    duration_sec: int


class WeighInPublic(_Row):
    measured_at: datetime
    weight_kg: float
    body_fat_pct: float | None
    note: str | None


class MacroTargetPublic(_Row):
    effective_from: date
    kcal: float
    protein: float
    carbs: float
    fat: float
    # Limits and the fiber goal; None means the WHO default.
    sat_fat_max_g: float | None = None
    sugar_max_g: float | None = None
    sodium_max_mg: float | None = None
    fiber_g: float | None = None


class MealPublic(_Row):
    eaten_at: datetime
    label: str
    source: str
    photo_media_id: uuid.UUID | None
    raw_input: str
    status: str
    confidence: float | None
    follow_up: dict[str, object] | None


class MealItemPublic(_Row):
    meal_id: uuid.UUID
    position: int
    name: str
    qty: float
    unit: str
    kcal: float
    protein: float
    carbs: float
    fat: float
    assumption: str | None
    fiber: float | None = None
    sat_fat: float | None = None
    sugar: float | None = None
    sodium: float | None = None


class FitnessSettingsPublic(_Row):
    units: str
    rest_sec: int
    weekly_target: int
    weigh_in_reminder: str | None
    progression: str
    ai_source: str
    goal_direction: str
    goal_weight: float | None
    setup_done: bool
    sex: str | None
    birth_year: int | None
    height_cm: float | None
    activity_level: str | None
    plan_goal: str | None


# --------------------------------------------------------------------------
# Sync payloads: every field optional (field-level last-writer-wins)
# --------------------------------------------------------------------------


class ExerciseIn(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=80)
    equipment: Equipment | None = None
    muscle: Muscle | None = None
    load_type: LoadType | None = None
    rep_min: int | None = Field(default=None, ge=1, le=1000)
    rep_max: int | None = Field(default=None, ge=1, le=1000)
    increment: float | None = Field(default=None, ge=0, le=100)
    archived: bool | None = None
    track: TimeTrack | None = None


class WorkoutTemplateIn(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=80)
    sort_order: int | None = None


class TemplateItemIn(BaseModel):
    template_id: uuid.UUID | None = None
    exercise_id: uuid.UUID | None = None
    position: int | None = Field(default=None, ge=0, le=1000)
    sets: int | None = Field(default=None, ge=1, le=20)
    target_sec: int | None = Field(default=None, ge=1, le=86400)


class WorkoutIn(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=80)
    template_id: uuid.UUID | None = None
    started_at: datetime | None = None
    ended_at: datetime | None = None
    status: Literal["in_progress", "finished"] | None = None
    notes: str | None = Field(default=None, max_length=2000)
    source: Literal["live", "chat"] | None = None


class WorkoutExerciseIn(BaseModel):
    workout_id: uuid.UUID | None = None
    exercise_id: uuid.UUID | None = None
    position: int | None = Field(default=None, ge=-1000, le=1000)
    note: str | None = Field(default=None, max_length=500)


class WorkoutSetIn(BaseModel):
    workout_exercise_id: uuid.UUID | None = None
    position: int | None = Field(default=None, ge=0, le=1000)
    reps: int | None = Field(default=None, ge=0, le=1000)
    weight: float | None = OptKg
    kind: SetKind | None = None
    completed_at: datetime | None = None
    duration_sec: int | None = Field(default=None, ge=0, le=86400)
    speed_kmh: float | None = Field(default=None, ge=0, le=60)
    unit: Units | None = None


class WeighInIn(BaseModel):
    measured_at: datetime | None = None
    weight_kg: float | None = Field(default=None, gt=0, lt=500)
    body_fat_pct: float | None = Field(default=None, gt=0, lt=100)
    note: str | None = Field(default=None, max_length=280)


class MacroTargetIn(BaseModel):
    effective_from: date | None = None
    kcal: float | None = OptMacro
    protein: float | None = OptMacro
    carbs: float | None = OptMacro
    fat: float | None = OptMacro
    sat_fat_max_g: float | None = OptMacro
    sugar_max_g: float | None = OptMacro
    sodium_max_mg: float | None = OptMacro
    fiber_g: float | None = OptMacro


class MealIn(BaseModel):
    eaten_at: datetime | None = None
    label: MealLabel | None = None
    source: MealSource | None = None
    raw_input: str | None = Field(default=None, max_length=2000)
    status: MealStatus | None = None
    confidence: float | None = Field(default=None, ge=0, le=1)
    follow_up: dict[str, object] | None = None


class MealItemIn(BaseModel):
    meal_id: uuid.UUID | None = None
    position: int | None = Field(default=None, ge=0, le=1000)
    name: str | None = Field(default=None, min_length=1, max_length=120)
    qty: float | None = Field(default=None, gt=0, le=100000)
    unit: str | None = Field(default=None, min_length=1, max_length=24)
    kcal: float | None = OptMacro
    protein: float | None = OptMacro
    carbs: float | None = OptMacro
    fat: float | None = OptMacro
    assumption: str | None = Field(default=None, max_length=280)
    fiber: float | None = OptMacro
    sat_fat: float | None = OptMacro
    sugar: float | None = OptMacro
    sodium: float | None = Field(default=None, ge=0, le=100000)


class FitnessSettingsIn(BaseModel):
    units: Units | None = None
    rest_sec: int | None = Field(default=None, ge=0, le=900)
    weekly_target: int | None = Field(default=None, ge=0, le=14)
    # HH:MM in the user's clock, or null to turn the reminder off.
    weigh_in_reminder: str | None = Field(
        default=None, pattern=r"^([01]\d|2[0-3]):[0-5]\d$"
    )
    progression: Progression | None = None
    ai_source: AiSource | None = None
    goal_direction: GoalDirection | None = None
    goal_weight: float | None = Field(default=None, gt=0, lt=500)
    setup_done: bool | None = None
    sex: Sex | None = None
    birth_year: int | None = Field(default=None, ge=1900)
    height_cm: float | None = Field(default=None, ge=100, le=250)
    activity_level: ActivityLevel | None = None
    plan_goal: PlanGoal | None = None

    @field_validator("birth_year")
    @classmethod
    def _adult_enough(cls, v: int | None) -> int | None:
        if v is not None and v > date.today().year - 13:
            raise ValueError("must be at least 13 years old")
        return v


# --------------------------------------------------------------------------
# REST requests
# --------------------------------------------------------------------------


class StartWorkout(BaseModel):
    source: Literal["empty", "template", "repeat"] = "empty"
    template_id: uuid.UUID | None = None
    workout_id: uuid.UUID | None = None
    id: uuid.UUID | None = None


class FinishWorkout(BaseModel):
    unfinished: Literal["remove", "done"] = "remove"
    end_at: datetime | None = None


class WorkoutMeta(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=80)
    notes: str | None = Field(default=None, max_length=2000)


class AddExercises(BaseModel):
    exercise_ids: list[uuid.UUID] = Field(min_length=1, max_length=30)
    ids: list[uuid.UUID] | None = None


class MoveExercise(BaseModel):
    dir: Literal[-1, 1]


class ReplaceExercise(BaseModel):
    exercise_id: uuid.UUID


class ExerciseNote(BaseModel):
    note: str = Field(max_length=500)


class AddSet(BaseModel):
    id: uuid.UUID | None = None


class SetPatch(BaseModel):
    reps: int | None = Field(default=None, ge=0, le=1000)
    weight: float | None = OptKg
    kind: SetKind | None = None


class RestStart(BaseModel):
    sec: int | None = Field(default=None, ge=0, le=900)


class RestAdjust(BaseModel):
    delta: int = Field(ge=-900, le=900)


class TemplateItemSpec(BaseModel):
    exercise_id: uuid.UUID
    sets: int = Field(default=3, ge=1, le=20)


class TemplateUpsert(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    items: list[TemplateItemSpec] = Field(default_factory=list, max_length=40)
    id: uuid.UUID | None = None


class SaveAsTemplate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=80)
    id: uuid.UUID | None = None


class ExerciseUpsert(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    equipment: Equipment = "barbell"
    muscle: Muscle = "chest"
    load_type: LoadType = "weight"
    rep_min: int = Field(default=8, ge=1, le=1000)
    rep_max: int = Field(default=12, ge=1, le=1000)
    increment: float = Field(default=2.5, ge=0, le=100)
    archived: bool = False
    track: TimeTrack | None = None
    id: uuid.UUID | None = None


class ArchiveExercise(BaseModel):
    archived: bool = True


class WeighInCreate(BaseModel):
    weight_kg: float = Field(gt=0, lt=500)
    measured_at: datetime | None = None
    body_fat_pct: float | None = Field(default=None, gt=0, lt=100)
    note: str | None = Field(default=None, max_length=280)
    id: uuid.UUID | None = None


class WeighInUpdate(BaseModel):
    weight_kg: float | None = Field(default=None, gt=0, lt=500)
    measured_at: datetime | None = None
    body_fat_pct: float | None = Field(default=None, gt=0, lt=100)
    note: str | None = Field(default=None, max_length=280)


class ItemSpec(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    qty: float = Field(gt=0, le=100000)
    unit: str = Field(min_length=1, max_length=24)
    kcal: float = Macro
    protein: float = Macro
    carbs: float = Macro
    fat: float = Macro
    assumption: str | None = Field(default=None, max_length=280)
    id: uuid.UUID | None = None


class MealCreate(BaseModel):
    items: list[ItemSpec] = Field(min_length=1, max_length=40)
    eaten_at: datetime | None = None
    label: MealLabel | None = None
    source: MealSource = "manual"
    raw_input: str | None = Field(default=None, max_length=2000)
    id: uuid.UUID | None = None


class MealEstimate(BaseModel):
    text: str = Field(min_length=1, max_length=2000)
    eaten_at: datetime | None = None
    label: MealLabel | None = None
    source: Literal["text", "voice", "photo"] = "text"
    id: uuid.UUID | None = None


class MealPhoto(BaseModel):
    hint: str = Field(default="", max_length=500)
    eaten_at: datetime | None = None
    photo_media_id: uuid.UUID | None = None
    id: uuid.UUID | None = None


class Reestimate(BaseModel):
    hint: str | None = Field(default=None, min_length=1, max_length=500)


class MealUpdate(BaseModel):
    eaten_at: datetime | None = None
    label: MealLabel | None = None
    raw_input: str | None = Field(default=None, max_length=2000)


class FollowUpAnswerIn(BaseModel):
    option: str = Field(min_length=1, max_length=40)


class ItemPatch(BaseModel):
    qty: float | None = Field(default=None, gt=0, le=100000)
    name: str | None = Field(default=None, min_length=1, max_length=120)
    kcal: float | None = OptMacro
    protein: float | None = OptMacro
    carbs: float | None = OptMacro
    fat: float | None = OptMacro


class AddMealItem(BaseModel):
    food_key: str | None = Field(default=None, max_length=40)
    item: ItemSpec | None = None
    id: uuid.UUID | None = None


class DuplicateMeal(BaseModel):
    day: date | None = None
    id: uuid.UUID | None = None


LIMIT_FIELDS = ("sat_fat_max_g", "sugar_max_g", "sodium_max_mg", "fiber_g")


class TargetSet(BaseModel):
    kcal: float = Macro
    protein: float = Macro
    carbs: float = Macro
    fat: float = Macro
    # Omitted or null: the WHO default.
    sat_fat_max_g: float | None = OptMacro
    sugar_max_g: float | None = OptMacro
    sodium_max_mg: float | None = OptMacro
    fiber_g: float | None = OptMacro


# --------------------------------------------------------------------------
# REST responses
# --------------------------------------------------------------------------


class SetOut(WorkoutSetPublic):
    pass


class WorkoutExerciseOut(WorkoutExercisePublic):
    exercise_name: str
    sets: list[SetOut]


class TotalsOut(BaseModel):
    volume: float
    done: int
    planned: int
    duration_sec: float


class PrOut(BaseModel):
    workout_id: uuid.UUID
    exercise_id: uuid.UUID
    kind: str
    label: str
    value: float
    prev: float
    at: datetime


class WorkoutOut(WorkoutPublic):
    exercises: list[WorkoutExerciseOut]
    totals: TotalsOut
    prs: list[PrOut]


class StartWorkoutOut(BaseModel):
    workout: WorkoutOut
    resumed: bool


class ToggleSetOut(BaseModel):
    completed: bool
    set: SetOut
    rest: RestTimerPublic | None


class WorkoutSummary(WorkoutPublic):
    exercise_count: int
    totals: TotalsOut
    pr_count: int


class WorkoutsOut(BaseModel):
    data: list[WorkoutSummary]
    count: int


class SuggestionOut(BaseModel):
    kind: str
    weight: float
    reps: int
    badge: str
    detail: str
    last_weight: float | None
    last_reps: list[int] | None


class ExerciseWithStats(ExercisePublic):
    last_done_at: datetime | None
    best_e1rm: float | None
    suggestion: SuggestionOut
    stalled: bool


class ExercisesOut(BaseModel):
    data: list[ExerciseWithStats]
    count: int


class HistoryPointOut(BaseModel):
    workout_id: uuid.UUID
    started_at: datetime
    best_e1rm: float
    heaviest: float
    volume: float
    done_sets: int
    top_reps: int | None
    top_weight: float | None


class ExerciseDetail(ExerciseWithStats):
    history: list[HistoryPointOut]
    prs: list[PrOut]


class TemplateItemOut(BaseModel):
    exercise_id: uuid.UUID
    exercise_name: str
    sets: int


class TemplateOut(WorkoutTemplatePublic):
    items: list[TemplateItemOut]
    last_used_at: datetime | None


class TemplatesOut(BaseModel):
    data: list[TemplateOut]
    count: int


class WeighInsOut(BaseModel):
    data: list[WeighInPublic]
    count: int


class TrendPointOut(BaseModel):
    day: date
    raw: float | None
    avg: float | None


class WeeklyRateOut(BaseModel):
    kg: float
    pct: float
    avg: float


class BodyOut(BaseModel):
    latest: WeighInPublic | None
    trend: list[TrendPointOut]
    weekly_rate: WeeklyRateOut | None
    goal_direction: str
    goal_weight: float | None


class MacrosOut(BaseModel):
    kcal: float
    protein: float
    carbs: float
    fat: float


class MealOut(MealPublic):
    items: list[MealItemPublic]
    totals: MacrosOut


class MealsOut(BaseModel):
    data: list[MealOut]
    count: int


class NutritionDayOut(BaseModel):
    day: date
    totals: MacrosOut
    target: MacroTargetPublic | None
    left: MacrosOut | None
    pending: int
    to_review: int
    meals: list[MealOut]


class DayVerdictOut(BaseModel):
    day: date
    totals: MacrosOut
    target: MacrosOut | None
    meals: int
    kcal_ok: bool
    protein_hit: bool
    over: bool
    verdict: str


class AdherenceOut(BaseModel):
    logged: int
    calorie: float
    protein: float
    over_days: int
    coverage: float


class NutritionHistoryOut(BaseModel):
    days: list[DayVerdictOut]
    adherence: AdherenceOut


class TargetsOut(BaseModel):
    current: MacroTargetPublic | None
    history: list[MacroTargetPublic]


class WeekOut(BaseModel):
    start: date
    count: int


class TopLiftOut(BaseModel):
    exercise_id: uuid.UUID
    name: str
    best_e1rm: float
    first_e1rm: float
    stalled: bool


class PeriodOut(BaseModel):
    sessions: int
    target: float
    session_rate: float
    missed: int
    prs: int
    volume: float


class StatsOut(BaseModel):
    days: int
    period: PeriodOut
    previous: PeriodOut
    weeks: list[WeekOut]
    streak: int
    overload_rate: float
    top_lifts: list[TopLiftOut]
    stalled: list[uuid.UUID]
    prs: list[PrOut]
    weight_trend: list[TrendPointOut]
    weekly_rate: WeeklyRateOut | None
    adherence: AdherenceOut
    area_rate: float


class OverviewOut(BaseModel):
    active: WorkoutPublic | None
    next_template: TemplateOut | None
    last_workout: WorkoutSummary | None
    week: WeekOut
    weekly_target: int
    streak: int
    latest_weight: WeighInPublic | None
    weekly_rate: WeeklyRateOut | None
    macros_left: MacrosOut | None
    today_totals: MacrosOut
    pending_meals: int
    weighed_today: bool


class ShareLineOut(BaseModel):
    exercise_id: uuid.UUID
    name: str
    top_reps: int | None
    top_weight: float | None
    e1rm: float


class ShareCardOut(BaseModel):
    workout: WorkoutPublic
    totals: TotalsOut
    prs: list[PrOut]
    lines: list[ShareLineOut]
    focus_exercise_id: uuid.UUID | None
    focus_pr: PrOut | None
    series: list[float]
    week_sessions: int
    weekly_target: int
    streak: int
    bodyweight: float | None
    day_macros: MacrosOut


class ResetOut(BaseModel):
    removed: int
