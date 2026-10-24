"""Focus (ADR-0025): the person's focus timer and what they did with the time.

A **session** is one sitting at the timer, in one of two modes: a Pomodoro
(focus sets and breaks of configured lengths) or a free stopwatch. Its
history is a sequence of **segments** that never overlap within the session:
each is a span of focus, break or pause, with the item worked on (a task, a
habit, or nothing) copied onto it. A pause is a segment of its own, so pauses
are stored as intervals rather than a total; switching items mid-timer closes
one focus segment and opens the next.

Everything the timer shows is derived from the segments' timestamps (see
``logic.py``), never from a running counter, so a killed app, a locked phone
or a second device reads the same state. ``focus_sec``, ``sets_completed``
and ``day`` on the session are server-derived from its segments.
"""

import uuid
from datetime import date, datetime

from sqlalchemy import CheckConstraint, Index, Integer, String, UniqueConstraint
from sqlmodel import Field

from app.shared.owned import OwnedRow, enum_check, tstz

MODES = ("pomodoro", "stopwatch")
END_REASONS = ("completed", "abandoned")
SEGMENT_KINDS = ("focus", "break", "pause")
ITEM_KINDS = ("task", "habit")


class FocusSession(OwnedRow, table=True):
    __tablename__ = "focus_session"
    __table_args__ = (
        enum_check("mode", MODES, name="ck_focus_session_mode"),
        CheckConstraint(
            "end_reason IS NULL OR end_reason IN ('completed', 'abandoned')",
            name="ck_focus_session_end_reason",
        ),
        CheckConstraint(
            "item_kind IS NULL OR item_kind IN ('task', 'habit')",
            name="ck_focus_session_item_kind",
        ),
        CheckConstraint(
            "(item_kind IS NULL) = (item_id IS NULL)", name="ck_focus_session_item"
        ),
        CheckConstraint(
            "ended_at IS NULL OR ended_at >= started_at", name="ck_focus_session_range"
        ),
        CheckConstraint(
            "focus_min BETWEEN 1 AND 240 AND short_break_min BETWEEN 1 AND 60"
            " AND long_break_min BETWEEN 1 AND 120 AND sets_before_long BETWEEN 1 AND 12",
            name="ck_focus_session_lengths",
        ),
        CheckConstraint(
            "focus_sec >= 0 AND sets_completed >= 0", name="ck_focus_session_totals"
        ),
        Index("ix_focus_session_owner_day", "owner_id", "day"),
    )

    mode: str = Field(default="pomodoro", sa_type=String(10))  # type: ignore
    # "25-5", "50-10", "90-20" or "custom"; the lengths below are what ran.
    preset: str | None = Field(default=None, max_length=16)
    focus_min: int = Field(default=25, sa_type=Integer)
    short_break_min: int = Field(default=5, sa_type=Integer)
    long_break_min: int = Field(default=15, sa_type=Integer)
    sets_before_long: int = Field(default=4, sa_type=Integer)
    auto_start_breaks: bool = True
    auto_start_focus: bool = False
    started_at: datetime = Field(sa_type=tstz())  # type: ignore
    ended_at: datetime | None = Field(default=None, sa_type=tstz())  # type: ignore
    end_reason: str | None = Field(default=None, sa_type=String(10))  # type: ignore
    # What the person is working on now; each new segment copies it.
    item_kind: str | None = Field(default=None, sa_type=String(5))  # type: ignore
    item_id: uuid.UUID | None = None
    item_title: str | None = Field(default=None, max_length=160)
    # Server-derived from the segments.
    day: date | None = Field(default=None)
    focus_sec: int = Field(default=0, sa_type=Integer)
    sets_completed: int = Field(default=0, sa_type=Integer)


class FocusSegment(OwnedRow, table=True):
    """One span of focus, break or pause. ``ended_at`` NULL: running now."""

    __tablename__ = "focus_segment"
    __table_args__ = (
        enum_check("kind", SEGMENT_KINDS, name="ck_focus_segment_kind"),
        CheckConstraint(
            "item_kind IS NULL OR item_kind IN ('task', 'habit')",
            name="ck_focus_segment_item_kind",
        ),
        CheckConstraint(
            "(item_kind IS NULL) = (item_id IS NULL)", name="ck_focus_segment_item"
        ),
        CheckConstraint(
            "ended_at IS NULL OR ended_at >= started_at", name="ck_focus_segment_range"
        ),
        CheckConstraint("set_index BETWEEN 0 AND 999", name="ck_focus_segment_set"),
        CheckConstraint(
            "planned_sec IS NULL OR planned_sec BETWEEN 1 AND 86400",
            name="ck_focus_segment_planned",
        ),
        Index("ix_focus_segment_owner_item", "owner_id", "item_id"),
        Index("ix_focus_segment_owner_started", "owner_id", "started_at"),
    )

    session_id: uuid.UUID = Field(
        foreign_key="focus_session.id", ondelete="CASCADE", index=True
    )
    kind: str = Field(sa_type=String(5))  # type: ignore
    started_at: datetime = Field(sa_type=tstz())  # type: ignore
    ended_at: datetime | None = Field(default=None, sa_type=tstz())  # type: ignore
    # The Pomodoro set (0-based) this focus, its break or a pause in either
    # belongs to; a stopwatch is all set 0.
    set_index: int = Field(default=0, sa_type=Integer)
    # The set's (or break's) length in seconds including any extension; NULL
    # for a stopwatch, which has no target.
    planned_sec: int | None = Field(default=None, sa_type=Integer)
    item_kind: str | None = Field(default=None, sa_type=String(5))  # type: ignore
    item_id: uuid.UUID | None = None
    # The item's title when the segment was recorded, so the calendar can
    # label it after the task is renamed or deleted.
    item_title: str | None = Field(default=None, max_length=160)


class FocusSettings(OwnedRow, table=True):
    """One row per user: the daily goal and the timer's defaults."""

    __tablename__ = "focus_settings"
    __table_args__ = (
        UniqueConstraint("owner_id", name="uq_focus_settings_owner"),
        CheckConstraint(
            "daily_goal_min BETWEEN 0 AND 960", name="ck_focus_settings_goal"
        ),
        CheckConstraint(
            "focus_min BETWEEN 1 AND 240 AND short_break_min BETWEEN 1 AND 60"
            " AND long_break_min BETWEEN 1 AND 120 AND sets_before_long BETWEEN 1 AND 12",
            name="ck_focus_settings_lengths",
        ),
        enum_check("mode", MODES, name="ck_focus_settings_mode"),
    )

    # "Deep work" minutes a day; 0 turns the goal off.
    daily_goal_min: int = Field(default=120, sa_type=Integer)
    mode: str = Field(default="pomodoro", sa_type=String(10))  # type: ignore
    preset: str | None = Field(default="25-5", max_length=16)
    focus_min: int = Field(default=25, sa_type=Integer)
    short_break_min: int = Field(default=5, sa_type=Integer)
    long_break_min: int = Field(default=15, sa_type=Integer)
    sets_before_long: int = Field(default=4, sa_type=Integer)
    auto_start_breaks: bool = True
    auto_start_focus: bool = False
    notify: bool = True
