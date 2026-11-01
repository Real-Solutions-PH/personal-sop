"""Tasks & lists (IA M2). ``recurrence`` is a value object
(``{rule: {kind, ...}, mode: "fixed"|"after"}``) validated by the schema."""

import uuid
from datetime import date, datetime

from sqlalchemy import CheckConstraint, Integer, String, UniqueConstraint
from sqlmodel import Field

from app.shared.owned import JSONB, OwnedRow, enum_check, tstz

LIST_KINDS = ("standard", "shopping")
LIST_COLORS = ("tsk", "fin", "hab", "fit", "life", "warn")
LIST_ICONS = (
    "briefcase",
    "laptop",
    "home",
    "cart",
    "heart",
    "book",
    "plane",
    "gift",
    "list",
)
TASK_STATUSES = ("open", "done", "deleted")
TASK_SOURCES = ("manual", "capture-text", "capture-voice", "capture-photo")
EVENT_TYPES = (
    "created",
    "completed",
    "uncompleted",
    "rescheduled",
    "snoozed",
    "deleted",
    "restored",
)


class TaskList(OwnedRow, table=True):
    __tablename__ = "task_list"
    __table_args__ = (
        enum_check("kind", LIST_KINDS, name="ck_task_list_kind"),
        enum_check("color", LIST_COLORS, name="ck_task_list_color"),
        enum_check("icon", LIST_ICONS, name="ck_task_list_icon"),
    )

    name: str = Field(max_length=60)
    kind: str = Field(default="standard", sa_type=String(10))  # type: ignore
    color: str = Field(default="tsk", sa_type=String(8))  # type: ignore
    icon: str = Field(default="list", sa_type=String(12))  # type: ignore
    sort_order: int = 0
    archived_at: datetime | None = Field(default=None, sa_type=tstz())  # type: ignore
    is_default: bool = False


class Task(OwnedRow, table=True):
    """``list_id`` NULL is the Inbox. ``deleted_at`` (soft delete) mirrors the
    client's ``status: "deleted"`` so undo restores it."""

    __tablename__ = "task"
    __table_args__ = (
        enum_check("status", TASK_STATUSES, name="ck_task_status"),
        enum_check("source", TASK_SOURCES, name="ck_task_source"),
        enum_check("parse_state", ("parsed", "pending"), name="ck_task_parse"),
        CheckConstraint("reschedule_count >= 0", name="ck_task_reschedules"),
        CheckConstraint(
            "estimate_min IS NULL OR estimate_min BETWEEN 1 AND 6000",
            name="ck_task_estimate",
        ),
        CheckConstraint(
            "nag_every_min IS NULL OR nag_every_min BETWEEN 15 AND 720",
            name="ck_task_nag_every",
        ),
    )

    title: str = Field(max_length=280)
    list_id: uuid.UUID | None = Field(
        default=None, foreign_key="task_list.id", ondelete="SET NULL", index=True
    )
    due_date: date | None = Field(default=None, index=True)
    due_time: str | None = Field(default=None, max_length=5)
    remind_at: datetime | None = Field(default=None, sa_type=tstz())  # type: ignore
    recurrence: dict[str, object] | None = Field(default=None, sa_type=JSONB)
    notes: str | None = Field(default=None, max_length=4000)
    starred: bool = False
    # Free labels the person adds ("work", "errand"), shown in the lists.
    tags: list[str] = Field(
        default_factory=list,
        sa_type=JSONB,
        sa_column_kwargs={"server_default": "[]"},
    )
    status: str = Field(default="open", sa_type=String(8))  # type: ignore
    completed_at: datetime | None = Field(default=None, sa_type=tstz())  # type: ignore
    cleared_at: datetime | None = Field(default=None, sa_type=tstz())  # type: ignore
    source: str = Field(default="manual", sa_type=String(14))  # type: ignore
    parse_state: str = Field(default="parsed", sa_type=String(8))  # type: ignore
    original_due: date | None = None
    reschedule_count: int = 0
    sort_order: int = 0
    # How long the person expects it to take; Focus shows time spent
    # against it (ADR-0025).
    estimate_min: int | None = Field(default=None, sa_type=Integer)
    # "Keep reminding me": once overdue, remind again every this many
    # minutes for the rest of that day. NULL = off. The phone schedules
    # the repeats as local notifications.
    nag_every_min: int | None = Field(default=None, sa_type=Integer)
    # The task this one was spawned from by recurrence (derived id lineage).
    series_parent_id: uuid.UUID | None = Field(
        default=None, foreign_key="task.id", ondelete="SET NULL"
    )


class TaskEvent(OwnedRow, table=True):
    """Append-only history; drives reschedule counts, lateness and streaks."""

    __tablename__ = "task_event"
    __table_args__ = (enum_check("type", EVENT_TYPES, name="ck_task_event_type"),)

    task_id: uuid.UUID = Field(foreign_key="task.id", ondelete="CASCADE", index=True)
    type: str = Field(sa_type=String(12))  # type: ignore
    from_due: date | None = None
    to_due: date | None = None
    at: datetime = Field(sa_type=tstz(), index=True)  # type: ignore


class TaskSettings(OwnedRow, table=True):
    __tablename__ = "task_settings"
    __table_args__ = (
        UniqueConstraint("owner_id", name="uq_task_settings_owner"),
        CheckConstraint("week_start IN (0, 1)", name="ck_task_settings_week"),
    )

    default_remind_time: str = Field(default="09:00", max_length=5)
    digest_on: bool = False
    digest_time: str = Field(default="07:30", max_length=5)
    quiet_start: str = Field(default="22:00", max_length=5)
    quiet_end: str = Field(default="07:00", max_length=5)
    count_groceries: bool = True
    week_start: int = 1


class TaskNotifState(OwnedRow, table=True):
    """Per-device notification onboarding (install guide, permission)."""

    __tablename__ = "task_notif_state"
    __table_args__ = (
        UniqueConstraint("owner_id", name="uq_task_notif_owner"),
        enum_check(
            "permission", ("default", "granted", "denied"), name="ck_task_notif_perm"
        ),
    )

    platform: str = Field(default="ios", max_length=8)
    installed: bool = False
    permission: str = Field(default="default", sa_type=String(8))  # type: ignore
    remind_later_at: datetime | None = Field(default=None, sa_type=tstz())  # type: ignore
    test_sent_at: datetime | None = Field(default=None, sa_type=tstz())  # type: ignore
