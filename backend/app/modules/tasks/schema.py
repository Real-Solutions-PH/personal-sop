"""Request and response schemas of the tasks module.

Table models never leave the module: every route answers with a ``*Public``
schema. Field names are snake_case; the mobile client maps them.
"""

import uuid
from datetime import date, datetime
from typing import Annotated, Literal

from pydantic import AfterValidator, BaseModel, ConfigDict, Field, StringConstraints

from app.modules.tasks.models import LIST_COLORS, LIST_ICONS

ListKind = Literal["standard", "shopping"]
ListColor = Literal["tsk", "fin", "hab", "fit", "life", "warn"]
ListIcon = Literal[
    "briefcase", "laptop", "home", "cart", "heart", "book", "plane", "gift", "list"
]
TaskStatus = Literal["open", "done", "deleted"]
TaskSource = Literal["manual", "capture-text", "capture-voice", "capture-photo"]
ParseState = Literal["parsed", "pending"]
DeleteMode = Literal["inbox", "delete"]
Platform = Literal["ios", "android", "desktop"]
Permission = Literal["default", "granted", "denied"]

assert set(ListColor.__args__) == set(LIST_COLORS)  # type: ignore[attr-defined]
assert set(ListIcon.__args__) == set(LIST_ICONS)  # type: ignore[attr-defined]

HM = Annotated[str, Field(pattern=r"^([01]\d|2[0-3]):[0-5]\d$")]


def _aware(v: datetime | None) -> datetime | None:
    if v is not None and v.tzinfo is None:
        raise ValueError("timestamp needs a time zone")
    return v


Instant = Annotated[datetime, AfterValidator(_aware)]


# ---------------------------------------------------------------- recurrence


class Daily(BaseModel):
    kind: Literal["daily"]


class Weekdays(BaseModel):
    kind: Literal["weekdays"]


class Weekly(BaseModel):
    kind: Literal["weekly"]
    days: list[Annotated[int, Field(ge=0, le=6)]] = Field(min_length=1, max_length=7)


class Monthly(BaseModel):
    kind: Literal["monthly"]
    day: int = Field(ge=1, le=31)


class EveryN(BaseModel):
    kind: Literal["everyN"]
    n: int = Field(ge=1, le=365)


RepeatRule = Annotated[
    Daily | Weekdays | Weekly | Monthly | EveryN, Field(discriminator="kind")
]


class Recurrence(BaseModel):
    rule: RepeatRule
    mode: Literal["fixed", "after"] = "fixed"


# ---------------------------------------------------------------- lists


class ListCreate(BaseModel):
    id: uuid.UUID | None = None
    name: str = Field(min_length=1, max_length=60)
    kind: ListKind = "standard"
    color: ListColor = "tsk"
    icon: ListIcon = "list"


class ListUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=60)
    kind: ListKind | None = None
    color: ListColor | None = None
    icon: ListIcon | None = None


class ListSync(ListUpdate):
    """Sync payload: every field optional (field-level last-writer-wins)."""

    sort_order: int | None = Field(default=None, ge=0, le=10_000)
    archived_at: Instant | None = None
    is_default: bool | None = None


class ListPublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    name: str
    kind: ListKind
    color: ListColor
    icon: ListIcon
    sort_order: int
    archived_at: datetime | None
    is_default: bool
    version: int


class ListWithCounts(ListPublic):
    open_count: int = 0


class ListsPublic(BaseModel):
    data: list[ListWithCounts]
    count: int


class ArchiveIn(BaseModel):
    archived: bool


class MoveListIn(BaseModel):
    dir: Literal[-1, 1]


# ---------------------------------------------------------------- tasks


# Up to 8 labels of up to 24 characters (ops.clean_tags trims and dedupes).
Tags = Annotated[
    list[Annotated[str, StringConstraints(max_length=40)]], Field(max_length=20)
]


class TaskCreate(BaseModel):
    id: uuid.UUID | None = None
    title: str = Field(max_length=280)
    list_id: uuid.UUID | None = None
    due_date: date | None = None
    due_time: HM | None = None
    remind: bool = False
    remind_at: Instant | None = None
    recurrence: Recurrence | None = None
    notes: str | None = Field(default=None, max_length=4000)
    starred: bool = False
    tags: Tags = Field(default_factory=list)
    source: TaskSource = "manual"
    parse_state: ParseState = "parsed"


class TasksCreate(BaseModel):
    tasks: list[TaskCreate] = Field(min_length=1, max_length=100)


class TaskUpdate(BaseModel):
    """Edit in place (the detail sheet autosaves). Due changes go through
    ``PUT /tasks/{id}/due`` so a later date counts as a reschedule."""

    title: str | None = Field(default=None, max_length=280)
    notes: str | None = Field(default=None, max_length=4000)
    list_id: uuid.UUID | None = None
    starred: bool | None = None
    tags: Tags | None = None
    recurrence: Recurrence | None = None
    remind_at: Instant | None = None
    due_time: HM | None = None
    estimate_min: int | None = Field(default=None, ge=1, le=6000)


class TaskSync(BaseModel):
    """Sync payload: every field optional. Status changes are actions
    (``tasks.complete`` …), never field writes, so a recurring completion
    always spawns its next occurrence."""

    title: str | None = Field(default=None, max_length=280)
    list_id: uuid.UUID | None = None
    due_date: date | None = None
    due_time: HM | None = None
    remind_at: Instant | None = None
    recurrence: Recurrence | None = None
    notes: str | None = Field(default=None, max_length=4000)
    starred: bool | None = None
    tags: Tags | None = None
    estimate_min: int | None = Field(default=None, ge=1, le=6000)
    cleared_at: Instant | None = None
    source: TaskSource | None = None
    parse_state: ParseState | None = None
    sort_order: int | None = Field(default=None, ge=0, le=1_000_000)


class DueIn(BaseModel):
    due_date: date | None
    # Omitted = keep; null = clear.
    due_time: HM | None = None
    remind_at: Instant | None = None


class RescheduleIn(BaseModel):
    days: int = Field(ge=-365, le=365)


class SnoozeIn(BaseModel):
    minutes: int = Field(default=60, ge=1, le=7 * 24 * 60)


class CompleteIn(BaseModel):
    # When the device ticked it (an offline tick replayed later still counts
    # for the day it happened). Defaults to now; never in the future.
    completed_at: Instant | None = None


class MoveTaskIn(BaseModel):
    dir: Literal[-1, 1]
    # The visible order the move applies to (the screen's current list).
    ids: list[uuid.UUID] = Field(min_length=1, max_length=500)


class IdsIn(BaseModel):
    ids: list[uuid.UUID] = Field(min_length=1, max_length=500)


class CaptureIn(BaseModel):
    text: str = Field(min_length=1, max_length=4000)
    source: TaskSource = "capture-text"


class ParseIn(BaseModel):
    text: str = Field(max_length=500)


class TaskPublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    title: str
    list_id: uuid.UUID | None
    due_date: date | None
    due_time: str | None
    remind_at: datetime | None
    recurrence: Recurrence | None
    notes: str | None
    starred: bool
    tags: list[str] = []
    status: TaskStatus
    completed_at: datetime | None
    cleared_at: datetime | None
    deleted_at: datetime | None
    created_at: datetime
    source: TaskSource
    parse_state: ParseState
    original_due: date | None
    reschedule_count: int
    sort_order: int
    series_parent_id: uuid.UUID | None
    estimate_min: int | None = None
    version: int


class TaskDetail(TaskPublic):
    repeat_text: str | None = None
    list_name: str = "Inbox"


class TasksPublic(BaseModel):
    data: list[TaskPublic]
    count: int


class CompleteResult(BaseModel):
    task: TaskPublic
    next: TaskPublic | None


class CaptureResult(BaseModel):
    tasks: list[TaskPublic]
    follow_up: uuid.UUID | None


class CountResult(BaseModel):
    count: int


class IdsResult(BaseModel):
    ids: list[uuid.UUID]


class ParsePublic(BaseModel):
    title: str
    due_date: date | None
    due_time: str | None
    recurrence: Recurrence | None
    matched: list[str]


class OverdueTask(TaskPublic):
    days_late: int


class OverduePublic(BaseModel):
    data: list[OverdueTask]
    count: int


class CompletedDay(BaseModel):
    day: date
    tasks: list[TaskPublic]


class CompletedPublic(BaseModel):
    data: list[CompletedDay]
    count: int


# ---------------------------------------------------------------- today


class UpcomingPublic(BaseModel):
    day: date
    tasks: list[TaskPublic]


class TodayPublic(BaseModel):
    day: date
    overdue: list[TaskPublic]
    due: list[TaskPublic]
    done_today: list[TaskPublic]
    done_due_today: list[TaskPublic]
    upcoming: list[UpcomingPublic]
    later: list[TaskPublic]
    inbox: list[TaskPublic]
    starred: list[TaskPublic]
    shopping_open: int
    next_reminder: TaskPublic | None
    ever_had_tasks: bool
    due_now: list[uuid.UUID]
    progress_due: int
    progress_done: int


# ---------------------------------------------------------------- stats


class DayCountPublic(BaseModel):
    day: date
    done: int


class ListCountPublic(BaseModel):
    id: uuid.UUID | None
    name: str
    done: int


class StatsPublic(BaseModel):
    first: date
    last: date
    done: int
    on_time: int
    late: int
    with_due: int
    on_time_rate: float | None
    streak: int
    best_streak: int
    clear_days: int
    due_days: int
    overdue_now: int
    reschedules: int
    avg_reschedules: float
    avg_lateness: float | None
    follow_through: float
    capture_share: float | None
    created: int
    per_day: list[DayCountPublic]
    by_list: list[ListCountPublic]
    top_pushed: list[TaskPublic]


class StatsPair(BaseModel):
    days: int
    current: StatsPublic
    previous: StatsPublic


class ShareMetric(BaseModel):
    key: str
    label: str
    value: str
    default_on: bool


class SharePublic(BaseModel):
    days: int
    range_label: str
    metrics: list[ShareMetric]
    caption: str
    current: StatsPublic
    previous: StatsPublic


# ---------------------------------------------------------------- settings


class SettingsUpdate(BaseModel):
    default_remind_time: HM | None = None
    digest_on: bool | None = None
    digest_time: HM | None = None
    quiet_start: HM | None = None
    quiet_end: HM | None = None
    count_groceries: bool | None = None
    week_start: Literal[0, 1] | None = None


class SettingsPublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    default_remind_time: str
    digest_on: bool
    digest_time: str
    quiet_start: str
    quiet_end: str
    count_groceries: bool
    week_start: int
    version: int


class NotifUpdate(BaseModel):
    platform: Platform | None = None
    installed: bool | None = None
    permission: Permission | None = None
    remind_later_at: Instant | None = None
    test_sent_at: Instant | None = None


class NotifPublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    platform: str
    installed: bool
    permission: Permission
    remind_later_at: datetime | None
    test_sent_at: datetime | None
    version: int


# ---------------------------------------------------------------- sync actions


class TaskIdArgs(BaseModel):
    task_id: uuid.UUID


class CompleteArgs(TaskIdArgs):
    completed_at: Instant | None = None


class RescheduleArgs(TaskIdArgs):
    days: int = Field(ge=-365, le=365)


class SnoozeArgs(TaskIdArgs):
    minutes: int = Field(default=60, ge=1, le=7 * 24 * 60)


class NoArgs(BaseModel):
    pass


class ClearCheckedArgs(BaseModel):
    list_id: uuid.UUID


class DeleteListArgs(BaseModel):
    list_id: uuid.UUID
    mode: DeleteMode = "inbox"


class TaskIdsArgs(BaseModel):
    task_ids: list[uuid.UUID] = Field(min_length=1, max_length=500)
