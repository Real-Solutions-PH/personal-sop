"""Request and response shapes of the focus module (ADR-0025)."""

import uuid
from datetime import date, datetime
from typing import Literal

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field

Mode = Literal["pomodoro", "stopwatch"]
SegmentKind = Literal["focus", "break", "pause"]
ItemKind = Literal["task", "habit"]
EndReason = Literal["completed", "abandoned"]
Status = Literal["running", "paused", "waiting", "ended"]
Preset = Literal["25-5", "50-10", "90-20", "custom"]

FocusMin = Field(default=None, ge=1, le=240)
ShortMin = Field(default=None, ge=1, le=60)
LongMin = Field(default=None, ge=1, le=120)
SetsN = Field(default=None, ge=1, le=12)


# ---------------------------------------------------------------- sync rows


class SessionSyncIn(BaseModel):
    """Sync payload: every field optional (field-level last-writer-wins).
    ``day``, ``focus_sec`` and ``sets_completed`` are derived here."""

    mode: Mode | None = None
    preset: Preset | None = None
    focus_min: int | None = FocusMin
    short_break_min: int | None = ShortMin
    long_break_min: int | None = LongMin
    sets_before_long: int | None = SetsN
    auto_start_breaks: bool | None = None
    auto_start_focus: bool | None = None
    started_at: AwareDatetime | None = None
    ended_at: AwareDatetime | None = None
    end_reason: EndReason | None = None
    item_kind: ItemKind | None = None
    item_id: uuid.UUID | None = None
    item_title: str | None = Field(default=None, max_length=160)
    source: Literal["timer", "manual"] | None = None
    label: str | None = Field(default=None, max_length=80)


class SegmentSyncIn(BaseModel):
    session_id: uuid.UUID | None = None
    kind: SegmentKind | None = None
    started_at: AwareDatetime | None = None
    ended_at: AwareDatetime | None = None
    set_index: int | None = Field(default=None, ge=0, le=999)
    planned_sec: int | None = Field(default=None, ge=1, le=86400)
    item_kind: ItemKind | None = None
    item_id: uuid.UUID | None = None
    item_title: str | None = Field(default=None, max_length=160)


class SettingsIn(BaseModel):
    daily_goal_min: int | None = Field(default=None, ge=0, le=960)
    mode: Mode | None = None
    preset: Preset | None = None
    focus_min: int | None = FocusMin
    short_break_min: int | None = ShortMin
    long_break_min: int | None = LongMin
    sets_before_long: int | None = SetsN
    auto_start_breaks: bool | None = None
    auto_start_focus: bool | None = None
    notify: bool | None = None


class SessionPublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    mode: Mode
    preset: str | None
    focus_min: int
    short_break_min: int
    long_break_min: int
    sets_before_long: int
    auto_start_breaks: bool
    auto_start_focus: bool
    started_at: datetime
    ended_at: datetime | None
    end_reason: EndReason | None
    item_kind: ItemKind | None
    item_id: uuid.UUID | None
    item_title: str | None
    source: str = "timer"
    label: str | None = None
    day: date | None
    focus_sec: int
    sets_completed: int
    version: int


class SegmentPublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    session_id: uuid.UUID
    kind: SegmentKind
    started_at: datetime
    ended_at: datetime | None
    set_index: int
    planned_sec: int | None
    item_kind: ItemKind | None
    item_id: uuid.UUID | None
    item_title: str | None
    version: int


class SettingsPublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    daily_goal_min: int
    mode: Mode
    preset: str | None
    focus_min: int
    short_break_min: int
    long_break_min: int
    sets_before_long: int
    auto_start_breaks: bool
    auto_start_focus: bool
    notify: bool


class SettingsSyncOut(SettingsPublic):
    id: uuid.UUID
    version: int


# ---------------------------------------------------------------- reads


class ItemRef(BaseModel):
    kind: ItemKind
    id: uuid.UUID
    title: str | None = None


class PhaseOut(BaseModel):
    status: Status
    kind: Literal["focus", "break"]
    set_index: int
    planned_sec: int | None
    elapsed_sec: int
    remaining_sec: int | None
    long_break: bool
    ends_at: datetime | None
    item: ItemRef | None


class SessionDetail(SessionPublic):
    segments: list[SegmentPublic]
    phase: PhaseOut


class SessionsOut(BaseModel):
    data: list[SessionPublic]
    count: int


class ItemTime(BaseModel):
    item: ItemRef | None
    focus_sec: int


class TodayOut(BaseModel):
    day: date
    goal_min: int
    focus_sec: int
    sets_completed: int
    sessions: int
    streak: int
    items: list[ItemTime]
    current: SessionDetail | None


class Block(BaseModel):
    """One span on the day timeline, clipped to the day."""

    session_id: uuid.UUID
    segment_id: uuid.UUID
    kind: SegmentKind
    start: datetime
    end: datetime
    running: bool
    abandoned: bool
    item: ItemRef | None


class DayOut(BaseModel):
    day: date
    starts_at: datetime
    ends_at: datetime
    focus_sec: int
    goal_min: int
    blocks: list[Block]


class DayTotal(BaseModel):
    day: date
    focus_sec: int
    on_goal: bool


class RangeOut(BaseModel):
    first: date
    last: date
    goal_min: int
    days: list[DayTotal]
    items: list[ItemTime]
    focus_sec: int
    streak: int
    best_streak: int


class ItemSession(BaseModel):
    session_id: uuid.UUID
    day: date | None
    started_at: datetime
    focus_sec: int


class ItemTimeOut(BaseModel):
    """Time spent on one task or habit, and the sessions it came from."""

    item: ItemRef
    focus_sec: int
    today_sec: int
    week_sec: int
    estimate_min: int | None
    recent: list[ItemSession]


# ---------------------------------------------------------------- writes


class StartIn(BaseModel):
    id: uuid.UUID | None = None
    mode: Mode | None = None
    preset: Preset | None = None
    focus_min: int | None = FocusMin
    short_break_min: int | None = ShortMin
    long_break_min: int | None = LongMin
    sets_before_long: int | None = SetsN
    item: ItemRef | None = None


class SwitchIn(BaseModel):
    item: ItemRef | None = None


class ExtendIn(BaseModel):
    sec: int = Field(gt=0, le=3600)


class StopIn(BaseModel):
    abandon: bool = False
