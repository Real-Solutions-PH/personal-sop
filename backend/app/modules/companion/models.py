"""Sol, the companion: its name, the conversation, trackers and memories."""

from sqlalchemy import CheckConstraint, Float, String, UniqueConstraint
from sqlmodel import Field

from app.shared.owned import JSONB, OwnedRow, enum_check

METRICS = (
    "life",
    "habits",
    "tasks",
    "spend",
    "spendCats",
    "netWorth",
    "workouts",
    "weight",
    "nutrition",
)


class Companion(OwnedRow, table=True):
    __tablename__ = "companion"
    __table_args__ = (UniqueConstraint("owner_id", name="uq_companion_owner"),)

    name: str = Field(default="Sol", max_length=40)


class CompanionMessage(OwnedRow, table=True):
    """``blocks`` are the typed render blocks (text, chart, insights, coach,
    plan, tracker, memory, chips)."""

    __tablename__ = "companion_message"
    __table_args__ = (enum_check("role", ("me", "sol"), name="ck_companion_msg_role"),)

    role: str = Field(sa_type=String(3))  # type: ignore
    text: str | None = Field(default=None, max_length=8000)
    blocks: list[dict[str, object]] = Field(default_factory=list, sa_type=JSONB)


class Tracker(OwnedRow, table=True):
    __tablename__ = "tracker"
    __table_args__ = (
        UniqueConstraint("owner_id", "metric", name="uq_tracker_metric"),
        enum_check("metric", METRICS, name="ck_tracker_metric"),
        CheckConstraint(
            "direction IS NULL OR direction IN ('below', 'above')",
            name="ck_tracker_direction",
        ),
    )

    metric: str = Field(sa_type=String(10))  # type: ignore
    label: str = Field(max_length=80)
    goal: float | None = Field(default=None, sa_type=Float)
    direction: str | None = Field(default=None, sa_type=String(5))  # type: ignore


class Memory(OwnedRow, table=True):
    __tablename__ = "memory"

    text: str = Field(max_length=500)
