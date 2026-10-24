"""Request and response schemas of the dashboard module."""

import uuid
from datetime import date, datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

from app.modules.dashboard.logic import Pace, ShareTemplate
from app.modules.stats.schema import (
    GoalProgressOut,
    RingOut,
    TrophyOut,
)

ModuleKey = Literal["habits", "tasks", "fitness", "nutrition", "focus", "finance"]
Comparator = Literal["gte", "lte"]
Period = Literal["week", "month"]
GoalStatus = Literal["active", "archived"]
Via = Literal["manual", "onboarding", "review"]
NotifKind = Literal["reminder", "achievement", "review", "system", "social"]

TARGET_BOUND = 1e9


# ---------------------------------------------------------------- goals


class GoalCreate(BaseModel):
    id: uuid.UUID | None = None
    metric: str = Field(min_length=1, max_length=64)
    label: str = Field(min_length=1, max_length=120)
    target: float = Field(ge=-TARGET_BOUND, le=TARGET_BOUND, allow_inf_nan=False)
    unit: str = Field(default="", max_length=16)
    comparator: Comparator = "gte"
    period: Period = "week"
    via: Via = "manual"


class GoalUpdate(BaseModel):
    metric: str | None = Field(default=None, min_length=1, max_length=64)
    label: str | None = Field(default=None, min_length=1, max_length=120)
    target: float | None = Field(
        default=None, ge=-TARGET_BOUND, le=TARGET_BOUND, allow_inf_nan=False
    )
    unit: str | None = Field(default=None, max_length=16)
    comparator: Comparator | None = None
    period: Period | None = None


class GoalSyncIn(GoalUpdate):
    status: GoalStatus | None = None
    via: Via | None = None


class GoalPublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    metric: str
    label: str
    target: float
    unit: str
    comparator: Comparator
    period: Period
    status: GoalStatus
    via: Via
    created_at: datetime
    updated_at: datetime
    version: int


class GoalsOut(BaseModel):
    data: list[GoalProgressOut]
    count: int


# ---------------------------------------------------------------- reviews


class ReviewIn(BaseModel):
    done: bool | None = None
    reflection: str | None = Field(default=None, max_length=4000)
    focus: str | None = Field(default=None, max_length=64)
    # Also save the reflection to the journal.
    journal: bool = False


class ReviewSyncIn(BaseModel):
    key: str | None = Field(default=None, max_length=16)
    done: bool | None = None
    done_at: datetime | None = None
    reflection: str | None = Field(default=None, max_length=4000)
    focus: str | None = Field(default=None, max_length=64)


class ReviewPublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    key: str
    done: bool
    done_at: datetime | None
    reflection: str | None
    focus: str | None
    updated_at: datetime
    version: int


class ReviewsOut(BaseModel):
    data: list[ReviewPublic]
    count: int


# ---------------------------------------------------------------- wrap-up


class SealIn(BaseModel):
    day: date | None = None
    reflection: str | None = Field(default=None, max_length=4000)
    id: uuid.UUID | None = None


class WrapUpSyncIn(BaseModel):
    day: date | None = None
    at: datetime | None = None
    on_target: bool | None = None
    done: int | None = Field(default=None, ge=0, le=10_000)
    due: int | None = Field(default=None, ge=0, le=10_000)
    reflection: str | None = Field(default=None, max_length=4000)


class WrapUpPublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    day: date
    at: datetime
    on_target: bool
    done: int
    due: int
    reflection: str | None
    journal_entry_id: uuid.UUID | None
    updated_at: datetime
    version: int


class WrapUpState(BaseModel):
    day: date
    sealed: WrapUpPublic | None
    ring: RingOut
    threshold: float
    on_target_now: bool
    evening: bool


class WrapActionIn(BaseModel):
    kind: Literal["complete_task", "move_task_tomorrow", "check_habit", "skip_habit"]
    id: uuid.UUID
    day: date | None = None
    note: str | None = Field(default=None, max_length=200)


class WrapActionOut(BaseModel):
    kind: str
    id: uuid.UUID
    ring: RingOut


# ---------------------------------------------------------------- inbox


class NotificationPublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    at: datetime
    kind: NotifKind
    title: str
    body: str
    href: str
    read: bool
    updated_at: datetime
    version: int


class NotificationSyncIn(BaseModel):
    """A device may only mark read; dismiss is a delete op."""

    read: bool | None = None


class NotificationsOut(BaseModel):
    data: list[NotificationPublic]
    count: int
    unread: int


class MissNoteIn(BaseModel):
    note: str = Field(max_length=1000)


class MissNoteSyncIn(BaseModel):
    miss_key: str | None = Field(default=None, min_length=1, max_length=120)
    note: str | None = Field(default=None, min_length=1, max_length=1000)


class MissNotePublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    miss_key: str
    note: str
    updated_at: datetime
    version: int


# ---------------------------------------------------------------- share


class ShareFieldOut(BaseModel):
    key: str
    label: str
    on: bool
    sensitive: str | None


class ShareTemplateOut(BaseModel):
    key: ShareTemplate
    label: str
    formats: list[str]
    fields: list[ShareFieldOut]


class ShareDefaultsIn(BaseModel):
    fields: dict[str, bool]


class ShareDefaultSyncIn(BaseModel):
    template: ShareTemplate | None = None
    fields: dict[str, bool] | None = None


class ShareDefaultPublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    template: ShareTemplate
    fields: dict[str, bool]
    updated_at: datetime
    version: int


class ShareCardOut(BaseModel):
    """Everything a share card renders. Never a money amount (IA X-5)."""

    template: ShareTemplate
    fields: dict[str, bool]
    data: dict[str, Any]


# ---------------------------------------------------------------- onboarding


class OnboardingIn(BaseModel):
    modules: list[ModuleKey] = Field(max_length=4)
    pace: Pace = "gentle"
    # Per-module overrides of the pace's targets.
    targets: dict[ModuleKey, float] = Field(default_factory=dict)


class OnboardingOut(BaseModel):
    created: list[GoalPublic]
    skipped: list[ModuleKey]


# ---------------------------------------------------------------- today


class NextUpOut(BaseModel):
    id: str
    title: str
    module: str
    time: str | None
    href: str


class TodayCounts(BaseModel):
    items: int
    items_done: int
    misses_yesterday: int
    unread: int
    goals_active: int
    goals_hit: int
    trophies_unseen: int


class TodayBundle(BaseModel):
    day: date
    ring: RingOut
    threshold: float
    on_target_now: bool
    life_score: int | None
    level: str
    delta: int | None
    streak: int
    next_up: NextUpOut | None
    counts: TodayCounts
    wrap_up: WrapUpPublic | None
    evening: bool
    top_trophy: TrophyOut | None
