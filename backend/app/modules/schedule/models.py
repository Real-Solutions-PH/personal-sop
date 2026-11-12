"""Per-day schedule overrides (see ``logic``)."""

import uuid
from datetime import date

from sqlalchemy import String, UniqueConstraint
from sqlmodel import Field

from app.shared.owned import OwnedRow, enum_check


class ScheduleOverride(OwnedRow, table=True):
    """One item moved to another time on one day. Reset = tombstone; moving
    it again revives the same row (one per item and day)."""

    __tablename__ = "schedule_override"
    __table_args__ = (
        UniqueConstraint(
            "owner_id", "kind", "ref_id", "day", name="uq_schedule_override_item_day"
        ),
        enum_check(
            "kind", ("habit", "routine", "task"), name="ck_schedule_override_kind"
        ),
    )

    kind: str = Field(sa_type=String(8))  # type: ignore
    # The habit, routine or task moved (not a foreign key: three tables).
    ref_id: uuid.UUID = Field(index=True)
    day: date
    time: str = Field(sa_type=String(5))  # type: ignore
