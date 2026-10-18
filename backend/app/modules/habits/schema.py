"""Request and response schemas of the habits module (never table models)."""

import uuid
from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.shared.day import parse_hm

HabitType = Literal["check", "duration", "count"]
HabitStatus = Literal["active", "paused", "archived"]
LogStatus = Literal["done", "partial", "skipped"]
LogSource = Literal["tap", "timer", "routine", "capture", "workout"]
RoutineStatus = Literal["active", "archived"]
SortKey = Literal["rate", "streak", "skip", "name"]


class ScheduleSlot(BaseModel):
    """One slot of a schedule: weekdays (0 = Sunday), optional ``HH:MM`` time
    (empty = anytime) and the on-time window in minutes (default 60)."""

    model_config = ConfigDict(extra="forbid")

    days: list[int] = Field(max_length=7)
    time: str | None = None
    window: int | None = Field(default=None, ge=1, le=720)

    @field_validator("days")
    @classmethod
    def _days(cls, v: list[int]) -> list[int]:
        if any(d < 0 or d > 6 for d in v) or len(set(v)) != len(v):
            raise ValueError("days must be distinct weekdays 0..6")
        return sorted(v)

    @field_validator("time")
    @classmethod
    def _time(cls, v: str | None) -> str | None:
        if not v:
            return None
        parse_hm(v)
        return v


def _check_schedule(slots: list[ScheduleSlot] | None) -> list[ScheduleSlot] | None:
    if slots is None:
        return None
    if not any(s.days for s in slots):
        raise ValueError("a schedule needs at least one weekday")
    seen: set[int] = set()
    for s in slots:
        if seen & set(s.days):
            raise ValueError("a weekday can only be in one slot")
        seen |= set(s.days)
    return slots


Schedule = list[ScheduleSlot]
EVERY_DAY = [0, 1, 2, 3, 4, 5, 6]


# ---------------------------------------------------------------- habits


class HabitFields(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=80)
    icon: str | None = Field(default=None, min_length=1, max_length=32)
    type: HabitType | None = None
    target: float | None = Field(default=None, gt=0, le=100000)
    unit: str | None = Field(default=None, max_length=16)
    step: float | None = Field(default=None, gt=0, le=100000)
    schedule: Schedule | None = Field(default=None, max_length=7)
    reminder: bool | None = None
    link_workout: bool | None = None

    @field_validator("schedule")
    @classmethod
    def _schedule(cls, v: Schedule | None) -> Schedule | None:
        return _check_schedule(v)


class HabitCreate(HabitFields):
    id: uuid.UUID | None = None
    name: str = Field(min_length=1, max_length=80)


class HabitUpdate(HabitFields):
    sort_order: int | None = Field(default=None, ge=0, le=100000)


class HabitSyncIn(HabitUpdate):
    """Sync payload: every field optional (field-level last-writer-wins)."""

    status: HabitStatus | None = None
    archived_at: datetime | None = None


class PauseIn(BaseModel):
    until: date | None = None
    reason: str | None = Field(default=None, max_length=140)


class ReorderIn(BaseModel):
    dir: Literal[-1, 1]


class PausePublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    habit_id: uuid.UUID
    from_day: date
    to_day: date | None
    reason: str | None
    version: int


class HabitPauseSyncIn(BaseModel):
    habit_id: uuid.UUID | None = None
    from_day: date | None = None
    to_day: date | None = None
    reason: str | None = Field(default=None, max_length=140)


class HabitPublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    name: str
    icon: str
    type: str
    target: float | None
    unit: str | None
    step: float | None
    schedule: list[dict[str, object]]
    reminder: bool
    status: str
    link_workout: bool
    archived_at: datetime | None
    sort_order: int
    created_at: datetime
    version: int


class StatsOut(BaseModel):
    scheduled: int
    done: int
    partial: int
    skipped: int
    missed: int
    bonus: int
    minutes: float
    count_total: float
    rate: float
    skip_rate: float
    on_time: float


class BrokenOut(BaseModel):
    day: date
    length: int


class StreaksOut(BaseModel):
    current: int
    best: int
    broken: list[BrokenOut]


class HabitRow(BaseModel):
    """A habit list row: the habit, its effective status, the last 7 cells,
    streak and the 30-day stats."""

    habit: HabitPublic
    effective_status: str
    last7: list[str]
    streak: int
    stats: StatsOut


class HabitsPublic(BaseModel):
    data: list[HabitRow]
    count: int


class ArchivedRow(BaseModel):
    habit: HabitPublic
    created_day: date
    archived_day: date | None
    log_count: int
    stats: StatsOut
    best_streak: int


class ArchivedPublic(BaseModel):
    data: list[ArchivedRow]
    count: int


# ---------------------------------------------------------------- logs


class LogPublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    habit_id: uuid.UUID
    day: date
    status: str
    value: float | None
    logged_at: datetime
    source: str
    note: str | None
    version: int


class LogsPublic(BaseModel):
    data: list[LogPublic]
    count: int


class LogIn(BaseModel):
    id: uuid.UUID | None = None
    day: date | None = None
    status: LogStatus | None = None
    value: float | None = Field(default=None, ge=0, le=100000)
    add: bool = False
    note: str | None = Field(default=None, max_length=280)
    source: LogSource = "tap"


class CheckIn(BaseModel):
    day: date | None = None
    source: LogSource = "tap"


class IncrementIn(BaseModel):
    by: float | None = Field(default=None, gt=0, le=100000)
    day: date | None = None


class SkipIn(BaseModel):
    day: date | None = None
    note: str | None = Field(default=None, max_length=280)


class HabitLogSyncIn(BaseModel):
    habit_id: uuid.UUID | None = None
    day: date | None = None
    status: LogStatus | None = None
    value: float | None = Field(default=None, ge=0, le=100000)
    logged_at: datetime | None = None
    source: LogSource | None = None
    note: str | None = Field(default=None, max_length=280)


class DayEntry(BaseModel):
    """One habit on the day editor; ``status`` None clears the day's log."""

    habit_id: uuid.UUID
    status: LogStatus | None = None
    value: float | None = Field(default=None, ge=0, le=100000)
    note: str | None = Field(default=None, max_length=280)


class DayIn(BaseModel):
    entries: list[DayEntry] = Field(max_length=200)


class DayHabit(BaseModel):
    habit: HabitPublic
    cell: str
    scheduled: bool
    time: str | None
    log: LogPublic | None


class DayPublic(BaseModel):
    day: date
    habits: list[DayHabit]


# ---------------------------------------------------------------- settings


class SettingsPublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    week_start: int
    default_reminder: bool
    streak_nudge: bool


class SettingsIn(BaseModel):
    week_start: Literal[0, 1] | None = None
    default_reminder: bool | None = None
    streak_nudge: bool | None = None


class SettingsSyncOut(SettingsPublic):
    id: uuid.UUID
    version: int


# ---------------------------------------------------------------- routines


class StepIn(BaseModel):
    habit_id: uuid.UUID
    minutes: int = Field(gt=0, le=600)


class StepsIn(BaseModel):
    steps: list[StepIn] = Field(max_length=50)


class RoutineFields(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=80)
    icon: str | None = Field(default=None, min_length=1, max_length=32)
    schedule: Schedule | None = Field(default=None, max_length=7)
    reminder: bool | None = None

    @field_validator("schedule")
    @classmethod
    def _schedule(cls, v: Schedule | None) -> Schedule | None:
        return _check_schedule(v)


class RoutineCreate(RoutineFields):
    id: uuid.UUID | None = None
    name: str = Field(min_length=1, max_length=80)
    steps: list[StepIn] = Field(default_factory=list, max_length=50)


class RoutineUpdate(RoutineFields):
    pass


class RoutineSyncIn(RoutineFields):
    status: RoutineStatus | None = None


class RoutinePublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    name: str
    icon: str
    schedule: list[dict[str, object]]
    reminder: bool
    status: str
    created_at: datetime
    version: int


class RoutineStepPublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    routine_id: uuid.UUID
    habit_id: uuid.UUID
    position: int
    minutes: int
    version: int


class RoutineStepSyncIn(BaseModel):
    routine_id: uuid.UUID | None = None
    habit_id: uuid.UUID | None = None
    position: int | None = Field(default=None, ge=0, le=49)
    minutes: int | None = Field(default=None, gt=0, le=600)


class StepDetail(BaseModel):
    position: int
    habit_id: uuid.UUID
    name: str
    icon: str
    minutes: int
    archived: bool


class RoutineStatsOut(BaseModel):
    scheduled_days: int
    completed: int
    abandoned: int
    rate: float
    pace: float


class StepResultPublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    position: int
    habit_id: uuid.UUID
    status: str
    actual_sec: int


class RunPublic(BaseModel):
    id: uuid.UUID
    routine_id: uuid.UUID
    day: date
    started_at: datetime
    ended_at: datetime | None
    steps: list[dict[str, object]]
    results: list[StepResultPublic]
    current: int
    step_started_at: datetime
    step_paused_sec: int
    step_bonus_sec: int
    paused_at: datetime | None
    state: str
    version: int


class RoutineRunSyncOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    routine_id: uuid.UUID
    day: date
    started_at: datetime
    ended_at: datetime | None
    steps: list[dict[str, object]]
    current: int
    step_started_at: datetime
    step_paused_sec: int
    step_bonus_sec: int
    paused_at: datetime | None
    state: str
    version: int


class RunSyncIn(BaseModel):
    """Runs move only through ``habits.run.*`` actions; a field write is
    refused (see ``sync.py``)."""

    state: Literal["in_progress", "completed", "abandoned"] | None = None


class RoutineRow(BaseModel):
    routine: RoutinePublic
    step_count: int
    planned_min: int
    last_run_state: str | None
    last7: list[bool | None]
    stats: RoutineStatsOut


class RoutinesPublic(BaseModel):
    data: list[RoutineRow]
    count: int


class RoutineDetail(BaseModel):
    routine: RoutinePublic
    steps: list[StepDetail]
    planned_min: int
    archived_steps: int
    recent_runs: list[RunPublic]
    stats: RoutineStatsOut
    active_run: RunPublic | None


class PlayerState(BaseModel):
    """The routine player: the run plus the derived clock of its step."""

    run: RunPublic
    routine: RoutinePublic
    current_step: StepDetail | None
    next_step: StepDetail | None
    step_elapsed_sec: float
    step_planned_sec: int
    total_actual_sec: int
    planned_min: int


class SummaryStep(BaseModel):
    position: int
    habit_id: uuid.UUID
    name: str
    icon: str
    status: str
    actual_sec: int
    planned_sec: int
    streak: int


class RunSummary(BaseModel):
    run: RunPublic
    routine: RoutinePublic
    state: str
    steps: list[SummaryStep]
    actual_sec: int
    planned_sec: int
    fastest_this_month: bool


# ---------------------------------------------------------------- timer


class TimerPublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    habit_id: uuid.UUID
    day: date
    target_sec: int | None
    started_at: datetime
    paused_at: datetime | None
    paused_sec: int
    bonus_sec: int
    version: int


class TimerState(BaseModel):
    timer: TimerPublic | None
    elapsed_sec: float


class ExtendIn(BaseModel):
    sec: int = Field(gt=0, le=7200)


class FinishIn(BaseModel):
    """Measured minutes (editable on the finish sheet); omitted = the server's
    own measurement of the running timer."""

    minutes: float | None = Field(default=None, ge=0, le=1440)


class FinishOut(BaseModel):
    log: LogPublic


# ---------------------------------------------------------------- reads


class TodayHabit(BaseModel):
    habit: HabitPublic
    group: str
    time: str | None
    log: LogPublic | None
    streak: int


class TodayRoutine(BaseModel):
    routine: RoutinePublic
    step_count: int
    planned_min: int
    state: Literal["start", "resume", "done"]
    run: RunPublic | None


class TodayPublic(BaseModel):
    day: date
    habits: list[TodayHabit]
    routines: list[TodayRoutine]
    due: int
    done: int
    timer: TimerPublic | None


class OverallOut(BaseModel):
    rate: float
    skip_rate: float
    minutes: float
    perfect: int
    missed: int
    done: int


class SeriesDay(BaseModel):
    day: date
    due: int
    done: int
    rate: float | None


class PerHabit(BaseModel):
    habit: HabitPublic
    stats: StatsOut
    streaks: StreaksOut
    broken: list[BrokenOut]


class MostMissedOut(BaseModel):
    day: str
    count: int


class RoutineHome(BaseModel):
    routine: RoutinePublic
    stats: RoutineStatsOut
    abandoned: list[RunPublic]


class HabitsHome(BaseModel):
    """The habits analytics screen (HAB-16) for one period."""

    days: int
    first: date
    last: date
    current: OverallOut
    previous: OverallOut
    ranked: list[PerHabit]
    series: list[SeriesDay]
    rolling: list[int]
    heat: list[float | None]
    heat_first: date
    weekly_minutes: list[float]
    most_missed: MostMissedOut | None
    most_skipped: uuid.UUID | None
    low: list[uuid.UUID]
    routines: list[RoutineHome]


class HabitDetail(BaseModel):
    habit: HabitPublic
    effective_status: str
    current_pause: PausePublic | None
    pauses: list[PausePublic]
    streaks: StreaksOut
    stats: StatsOut
    heat_first: date
    heat: list[str]
    recent_logs: list[LogPublic]
    log_count: int


# ---------------------------------------------------------------- sync actions


class DayArgs(BaseModel):
    habit_id: uuid.UUID
    day: date | None = None


class CheckArgs(DayArgs):
    source: LogSource = "tap"


class IncrementArgs(DayArgs):
    by: float | None = Field(default=None, gt=0, le=100000)


class SkipArgs(DayArgs):
    note: str | None = Field(default=None, max_length=280)


class HabitArgs(BaseModel):
    habit_id: uuid.UUID


class NoArgs(BaseModel):
    pass


class ExtendArgs(BaseModel):
    sec: int = Field(gt=0, le=7200)


class FinishArgs(BaseModel):
    minutes: float | None = Field(default=None, ge=0, le=1440)


class StartRunArgs(BaseModel):
    routine_id: uuid.UUID
    run_id: uuid.UUID | None = None


class RunArgs(BaseModel):
    run_id: uuid.UUID


class StepResultSyncOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    run_id: uuid.UUID
    position: int
    habit_id: uuid.UUID
    status: str
    actual_sec: int
    version: int
