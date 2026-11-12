"""What the retention jobs know about each person and every engagement nudge
they decided on (docs/26-retention-algorithms.md §4.2, Slice 1).

Both are owned and tenant-scoped like every record (RLS, erasure), written
only by the server's jobs and the push-open handler, and never synced to the
phone. ``retention_profile`` is rebuilt each night in the person's local
03:00 hour; ``nudge`` is append-only apart from ``sent_at`` and
``opened_at``: one row per person per day on which a nudge was considered,
sent or held back, so every suppression is analysable.
"""

import uuid
from datetime import date, datetime

from sqlalchemy import CheckConstraint, Float, Index, Integer, String, UniqueConstraint
from sqlmodel import Field

from app.shared.owned import JSONB, OwnedRow, enum_check, tstz

STAGES = ("new", "lapsed", "lapsing", "returning", "steady", "drifting")
ARMS = ("holdout", "treated")
NUDGE_KINDS = ("best_time", "ladder_3", "ladder_7", "ladder_14", "ladder_30")
SUPPRESSIONS = (
    "opt_out",
    "active_today",
    "quiet",
    "fatigue",
    "backoff",
    "budget",
    "no_content",
    "no_push",
    "holdout",
)


class RetentionProfile(OwnedRow, table=True):
    __tablename__ = "retention_profile"
    __table_args__ = (
        UniqueConstraint("owner_id", name="uq_retention_profile_owner"),
        enum_check("stage", STAGES, name="ck_retention_profile_stage"),
        enum_check("arm", ARMS, name="ck_retention_profile_arm"),
        CheckConstraint("risk BETWEEN 0 AND 100", name="ck_retention_profile_risk"),
        CheckConstraint(
            "best_slot_weekday IS NULL OR best_slot_weekday BETWEEN 0 AND 47",
            name="ck_retention_profile_slot_weekday",
        ),
        CheckConstraint(
            "best_slot_weekend IS NULL OR best_slot_weekend BETWEEN 0 AND 47",
            name="ck_retention_profile_slot_weekend",
        ),
    )

    # Slice 2 fills these three; Slice 1 leaves them null / empty.
    archetype: str | None = Field(default=None, sa_type=String(16))  # type: ignore
    secondary: str | None = Field(default=None, sa_type=String(16))  # type: ignore
    tags: list[str] = Field(default_factory=list, sa_type=JSONB)
    stage: str = Field(default="new", sa_type=String(10))  # type: ignore
    risk: int = Field(default=0, sa_type=Integer)
    last_log_day: date | None = None
    # Every local day with a log, ever: the day-30 ladder note needs 7+.
    log_days_total: int = Field(default=0, sa_type=Integer)
    # {"weekday": [48 floats], "weekend": [48 floats]}
    slot_hist: dict[str, list[float]] = Field(default_factory=dict, sa_type=JSONB)
    best_slot_weekday: int | None = Field(default=None, sa_type=Integer)
    best_slot_weekend: int | None = Field(default=None, sa_type=Integer)
    ignore_streak: int = Field(default=0, sa_type=Integer)
    next_nudge_after: date | None = None
    ladder_step: int = Field(default=0, sa_type=Integer)
    goal_q: float | None = Field(default=None, sa_type=Float)
    arm: str = Field(default="treated", sa_type=String(16))  # type: ignore
    # The business day the nightly job last ran for (one run per day).
    computed_day: date | None = None


class Nudge(OwnedRow, table=True):
    __tablename__ = "nudge"
    __table_args__ = (
        UniqueConstraint("owner_id", "dedupe_key", name="uq_nudge_dedupe"),
        enum_check("kind", NUDGE_KINDS, name="ck_nudge_kind"),
        enum_check("arm", ARMS, name="ck_nudge_arm"),
        CheckConstraint(
            "suppressed IS NULL OR suppressed IN ("
            + ", ".join(f"'{s}'" for s in SUPPRESSIONS)
            + ")",
            name="ck_nudge_suppressed",
        ),
        Index("ix_nudge_owner_day", "owner_id", "day"),
    )

    # The person's business day the decision was for.
    day: date
    kind: str = Field(sa_type=String(16))  # type: ignore
    scheduled_for: datetime = Field(sa_type=tstz())  # type: ignore
    sent_at: datetime | None = Field(default=None, sa_type=tstz())  # type: ignore
    opened_at: datetime | None = Field(default=None, sa_type=tstz())  # type: ignore
    suppressed: str | None = Field(default=None, sa_type=String(16))  # type: ignore
    arm: str = Field(sa_type=String(16))  # type: ignore
    notification_id: uuid.UUID | None = Field(
        default=None, foreign_key="notification.id", ondelete="SET NULL", index=True
    )
    dedupe_key: str = Field(sa_type=String(40))  # type: ignore


__all__ = ["Nudge", "RetentionProfile"]
