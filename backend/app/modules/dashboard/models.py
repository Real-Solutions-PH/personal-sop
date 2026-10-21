"""Today, goals, reviews, wrap-ups, inbox and share defaults (IA M6)."""

import uuid
from datetime import date, datetime

from sqlalchemy import Float, String, UniqueConstraint
from sqlmodel import Field

from app.shared.owned import JSONB, OwnedRow, enum_check, tstz

NOTIF_KINDS = ("reminder", "achievement", "review", "system", "social")
SHARE_TEMPLATES = ("life", "weekly", "monthly", "streak", "finance", "profile", "goal")


class Goal(OwnedRow, table=True):
    """``metric`` is a metric ref: ``"life"`` or ``"<module>:<metricKey>"``."""

    __tablename__ = "goal"
    __table_args__ = (
        enum_check("comparator", ("gte", "lte"), name="ck_goal_comparator"),
        enum_check("period", ("week", "month"), name="ck_goal_period"),
        enum_check("status", ("active", "archived"), name="ck_goal_status"),
        enum_check("via", ("manual", "onboarding", "review"), name="ck_goal_via"),
    )

    metric: str = Field(max_length=64)
    label: str = Field(max_length=120)
    target: float = Field(sa_type=Float)
    unit: str = Field(default="", max_length=16)
    comparator: str = Field(default="gte", sa_type=String(3))  # type: ignore
    period: str = Field(default="week", sa_type=String(5))  # type: ignore
    status: str = Field(default="active", sa_type=String(8))  # type: ignore
    via: str = Field(default="manual", sa_type=String(10))  # type: ignore


class Review(OwnedRow, table=True):
    """Weekly ``w-YYYY-MM-DD`` / monthly ``m-YYYY-MM-DD`` review state."""

    __tablename__ = "review"
    __table_args__ = (UniqueConstraint("owner_id", "key", name="uq_review_key"),)

    key: str = Field(max_length=16)
    done: bool = False
    done_at: datetime | None = Field(default=None, sa_type=tstz())  # type: ignore
    reflection: str | None = Field(default=None, max_length=4000)
    focus: str | None = Field(default=None, max_length=64)


class WrapUp(OwnedRow, table=True):
    """A sealed day."""

    __tablename__ = "wrap_up"
    __table_args__ = (UniqueConstraint("owner_id", "day", name="uq_wrap_up_day"),)

    day: date
    at: datetime = Field(sa_type=tstz())  # type: ignore
    on_target: bool
    done: int
    due: int
    reflection: str | None = Field(default=None, max_length=4000)
    journal_entry_id: uuid.UUID | None = Field(
        default=None, foreign_key="journal_entry.id", ondelete="SET NULL"
    )


class MissNote(OwnedRow, table=True):
    """A note on a miss; ``miss_key`` is the stable id the misses feed emits."""

    __tablename__ = "miss_note"
    __table_args__ = (UniqueConstraint("owner_id", "miss_key", name="uq_miss_note"),)

    miss_key: str = Field(max_length=120)
    note: str = Field(max_length=1000)


class Notification(OwnedRow, table=True):
    """The one inbox (IA ruling X-11). ``dedupe_key`` stops a job from posting
    the same reminder twice."""

    __tablename__ = "notification"
    __table_args__ = (
        UniqueConstraint("owner_id", "dedupe_key", name="uq_notification_dedupe"),
        enum_check("kind", NOTIF_KINDS, name="ck_notification_kind"),
    )

    at: datetime = Field(sa_type=tstz(), index=True)  # type: ignore
    kind: str = Field(sa_type=String(12))  # type: ignore
    title: str = Field(max_length=120)
    body: str = Field(default="", max_length=500)
    href: str = Field(default="/today", max_length=255)
    read: bool = False
    dedupe_key: str | None = Field(default=None, max_length=120)
    pushed_at: datetime | None = Field(default=None, sa_type=tstz())  # type: ignore


class ShareDefault(OwnedRow, table=True):
    __tablename__ = "share_default"
    __table_args__ = (
        UniqueConstraint("owner_id", "template", name="uq_share_default"),
        enum_check("template", SHARE_TEMPLATES, name="ck_share_default_template"),
    )

    template: str = Field(sa_type=String(8))  # type: ignore
    fields: dict[str, bool] = Field(default_factory=dict, sa_type=JSONB)


__all__ = [
    "Goal",
    "MissNote",
    "Notification",
    "Review",
    "ShareDefault",
    "WrapUp",
]
