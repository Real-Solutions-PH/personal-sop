"""Screen time (spec 2026-10-29-screen-time-design): the person's app groups
and how much each was used per day.

A **group** is a name and a daily budget; the apps it covers were picked on
the phone and never leave it (Apple hands back opaque tokens). ``kind`` is
``"all"`` for the built-in group that counts all phone use (one per person)
or ``"custom"`` (up to six live ones).

A **day** row is one group's lower bound for one app day: the highest
DeviceActivity threshold the phone saw crossed. Writes only ever raise
``used_min`` and set ``closed`` (two devices or a replay can't lower it).
"""

import uuid
from datetime import date, datetime

from sqlalchemy import CheckConstraint, Index, Integer, String, UniqueConstraint, text
from sqlmodel import Field

from app.shared.owned import OwnedRow, enum_check, tstz

GROUP_KINDS = ("all", "custom")
MAX_CUSTOM_GROUPS = 6
NAME_MAX = 40


class ScreenGroup(OwnedRow, table=True):
    __tablename__ = "screen_group"
    __table_args__ = (
        enum_check("kind", GROUP_KINDS, name="ck_screen_group_kind"),
        CheckConstraint("budget_min >= 0", name="ck_screen_group_budget"),
        Index(
            "uq_screen_group_one_all",
            "owner_id",
            unique=True,
            postgresql_where=text("kind = 'all' AND deleted_at IS NULL"),
        ),
    )

    name: str = Field(max_length=NAME_MAX)
    kind: str = Field(default="custom", sa_type=String(8))  # type: ignore
    budget_min: int = Field(default=60, sa_type=Integer)
    sort_order: int = Field(default=0, sa_type=Integer)
    archived_at: datetime | None = Field(default=None, sa_type=tstz())  # type: ignore


class ScreenDay(OwnedRow, table=True):
    __tablename__ = "screen_day"
    __table_args__ = (
        UniqueConstraint("owner_id", "group_id", "day", name="uq_screen_day"),
        CheckConstraint("used_min >= 0", name="ck_screen_day_used"),
    )

    group_id: uuid.UUID = Field(
        foreign_key="screen_group.id", ondelete="CASCADE", index=True
    )
    day: date = Field(index=True)
    used_min: int = Field(default=0, sa_type=Integer)
    closed: bool = False
