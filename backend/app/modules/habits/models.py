"""Habits & routines (IA M1).

Schedules are value objects (``[{days: [0..6], time?: "HH:MM", window?: min}]``)
always read and written whole by the client, so they live in JSONB on the
habit/routine row and are validated by ``schema.ScheduleSlot``.
"""

import uuid
from datetime import date, datetime

from sqlalchemy import (
    CheckConstraint,
    Float,
    Index,
    Integer,
    String,
    UniqueConstraint,
    text,
)
from sqlmodel import Field

from app.shared.owned import JSONB, OwnedRow, enum_check, tstz

HABIT_TYPES = ("check", "duration", "count")
HABIT_STATUSES = ("active", "paused", "archived")
LOG_STATUSES = ("done", "partial", "skipped")
LOG_SOURCES = ("tap", "timer", "routine", "capture", "workout", "screen")
# A habit that completes itself from screen time (spec 2026-10-29).
RULE_KINDS = ("screen_limit",)
RULE_MAX_MIN = 1440
RUN_STATES = ("in_progress", "completed", "abandoned")
STEP_STATUSES = ("done", "skipped", "not_reached")


class Habit(OwnedRow, table=True):
    __tablename__ = "habit"
    __table_args__ = (
        enum_check("type", HABIT_TYPES, name="ck_habit_type"),
        enum_check("status", HABIT_STATUSES, name="ck_habit_status"),
        CheckConstraint("target IS NULL OR target > 0", name="ck_habit_target"),
        CheckConstraint(
            "rule_kind IS NULL OR rule_kind IN ('screen_limit')",
            name="ck_habit_rule_kind",
        ),
        CheckConstraint(
            "(rule_kind IS NULL) = (rule_group_id IS NULL)"
            " AND (rule_kind IS NULL) = (rule_max_min IS NULL)",
            name="ck_habit_rule",
        ),
        CheckConstraint(
            "rule_max_min IS NULL OR rule_max_min BETWEEN 0 AND 1440",
            name="ck_habit_rule_max",
        ),
        CheckConstraint(
            "nag_every_min IS NULL OR nag_every_min BETWEEN 15 AND 720",
            name="ck_habit_nag_every",
        ),
    )

    name: str = Field(max_length=80)
    icon: str = Field(default="✅", max_length=32)
    type: str = Field(default="check", sa_type=String(8))  # type: ignore
    target: float | None = Field(default=None, sa_type=Float)
    unit: str | None = Field(default=None, max_length=16)
    step: float | None = Field(default=None, sa_type=Float)
    schedule: list[dict[str, object]] = Field(default_factory=list, sa_type=JSONB)
    reminder: bool = False
    # "Keep reminding me": once a timed slot passes undone, remind again
    # every this many minutes for the rest of that day. NULL = off.
    nag_every_min: int | None = Field(default=None, sa_type=Integer)
    status: str = Field(default="active", sa_type=String(8))  # type: ignore
    link_workout: bool = False
    archived_at: datetime | None = Field(default=None, sa_type=tstz())  # type: ignore
    sort_order: int = 0
    # A screen-time rule: "group G, at most M minutes today". All three set
    # or none. A rule habit completes itself (``source="screen"`` logs the
    # phone writes) and refuses every manual action.
    rule_kind: str | None = Field(default=None, sa_type=String(16))  # type: ignore
    rule_group_id: uuid.UUID | None = Field(
        default=None, foreign_key="screen_group.id", ondelete="RESTRICT", index=True
    )
    rule_max_min: int | None = Field(default=None, sa_type=Integer)


class HabitPause(OwnedRow, table=True):
    """A pause range; ``to_day`` NULL means paused until resumed."""

    __tablename__ = "habit_pause"
    __table_args__ = (
        CheckConstraint(
            "to_day IS NULL OR to_day >= from_day", name="ck_habit_pause_range"
        ),
    )

    habit_id: uuid.UUID = Field(foreign_key="habit.id", ondelete="CASCADE", index=True)
    from_day: date
    to_day: date | None = None
    reason: str | None = Field(default=None, max_length=140)


class HabitLog(OwnedRow, table=True):
    """At most one log per habit per business day (re-logging edits it)."""

    __tablename__ = "habit_log"
    __table_args__ = (
        UniqueConstraint("habit_id", "day", name="uq_habit_log_day"),
        enum_check("status", LOG_STATUSES, name="ck_habit_log_status"),
        enum_check("source", LOG_SOURCES, name="ck_habit_log_source"),
        CheckConstraint("value IS NULL OR value >= 0", name="ck_habit_log_value"),
    )

    habit_id: uuid.UUID = Field(foreign_key="habit.id", ondelete="CASCADE", index=True)
    day: date = Field(index=True)
    status: str = Field(sa_type=String(8))  # type: ignore
    value: float | None = Field(default=None, sa_type=Float)
    logged_at: datetime = Field(sa_type=tstz())  # type: ignore
    source: str = Field(default="tap", sa_type=String(8))  # type: ignore
    note: str | None = Field(default=None, max_length=280)


class Routine(OwnedRow, table=True):
    __tablename__ = "routine"
    __table_args__ = (
        enum_check("status", ("active", "archived"), name="ck_routine_status"),
    )

    name: str = Field(max_length=80)
    icon: str = Field(default="sun", max_length=32)
    schedule: list[dict[str, object]] = Field(default_factory=list, sa_type=JSONB)
    reminder: bool = False
    status: str = Field(default="active", sa_type=String(8))  # type: ignore


class RoutineStep(OwnedRow, table=True):
    """Every step is a habit (OQ-HAB-3)."""

    __tablename__ = "routine_step"
    __table_args__ = (
        UniqueConstraint("routine_id", "position", name="uq_routine_step_pos"),
        CheckConstraint("minutes > 0 AND minutes <= 600", name="ck_routine_step_min"),
    )

    routine_id: uuid.UUID = Field(
        foreign_key="routine.id", ondelete="CASCADE", index=True
    )
    habit_id: uuid.UUID = Field(foreign_key="habit.id", ondelete="CASCADE", index=True)
    position: int = Field(sa_type=Integer)
    minutes: int = Field(sa_type=Integer)


class RoutineRun(OwnedRow, table=True):
    """One play-through of a routine. ``steps`` freezes the plan at start so
    editing the routine mid-run does not shift the player."""

    __tablename__ = "routine_run"
    __table_args__ = (
        Index(
            "uq_routine_run_one_active",
            "owner_id",
            unique=True,
            postgresql_where=text("state = 'in_progress' AND deleted_at IS NULL"),
        ),
        enum_check("state", RUN_STATES, name="ck_routine_run_state"),
    )

    routine_id: uuid.UUID = Field(
        foreign_key="routine.id", ondelete="CASCADE", index=True
    )
    day: date = Field(index=True)
    started_at: datetime = Field(sa_type=tstz())  # type: ignore
    ended_at: datetime | None = Field(default=None, sa_type=tstz())  # type: ignore
    steps: list[dict[str, object]] = Field(default_factory=list, sa_type=JSONB)
    current: int = 0
    step_started_at: datetime = Field(sa_type=tstz())  # type: ignore
    step_paused_sec: int = 0
    step_bonus_sec: int = 0
    paused_at: datetime | None = Field(default=None, sa_type=tstz())  # type: ignore
    state: str = Field(default="in_progress", sa_type=String(12))  # type: ignore


class RoutineStepResult(OwnedRow, table=True):
    __tablename__ = "routine_step_result"
    __table_args__ = (
        UniqueConstraint("run_id", "position", name="uq_routine_step_result_pos"),
        enum_check("status", STEP_STATUSES, name="ck_routine_step_result_status"),
    )

    run_id: uuid.UUID = Field(
        foreign_key="routine_run.id", ondelete="CASCADE", index=True
    )
    position: int
    habit_id: uuid.UUID = Field(foreign_key="habit.id", ondelete="CASCADE")
    status: str = Field(sa_type=String(12))  # type: ignore
    actual_sec: int = 0


class HabitTimer(OwnedRow, table=True):
    """The running habit timer (at most one per user)."""

    __tablename__ = "habit_timer"
    __table_args__ = (UniqueConstraint("owner_id", name="uq_habit_timer_owner"),)

    habit_id: uuid.UUID = Field(foreign_key="habit.id", ondelete="CASCADE")
    day: date
    target_sec: int | None = None
    started_at: datetime = Field(sa_type=tstz())  # type: ignore
    paused_at: datetime | None = Field(default=None, sa_type=tstz())  # type: ignore
    paused_sec: int = 0
    bonus_sec: int = 0


class HabitSettings(OwnedRow, table=True):
    __tablename__ = "habit_settings"
    __table_args__ = (
        UniqueConstraint("owner_id", name="uq_habit_settings_owner"),
        CheckConstraint("week_start IN (0, 1)", name="ck_habit_settings_week"),
    )

    week_start: int = 1
    default_reminder: bool = False
    streak_nudge: bool = True
