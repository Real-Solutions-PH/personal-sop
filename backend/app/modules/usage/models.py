"""App usage events: when the app comes to the foreground or leaves it, and
when a share card is shared. They answer what the record tables cannot: how
often people open Unfurl, how long they stay, and how many cards they share
(docs/25-retention-kpis.md).

A row carries the kind, the moment on the phone and, for a share, the card's
key (a fixed identifier from the app, never text the person typed). Owned and
tenant-scoped like every record, so erasure and RLS cover it. Append-only by
convention: the code only inserts. Not synced to the phone.
"""

from datetime import datetime

from sqlalchemy import CheckConstraint, Index, String
from sqlmodel import Field

from app.shared.owned import OwnedRow, enum_check, tstz

KINDS = ("app_open", "app_close", "share_card")
DETAIL_MAX = 40


class UsageEvent(OwnedRow, table=True):
    __tablename__ = "usage_event"
    __table_args__ = (
        enum_check("kind", KINDS, name="ck_usage_event_kind"),
        CheckConstraint(
            "(kind = 'share_card') = (detail IS NOT NULL)",
            name="ck_usage_event_detail",
        ),
        Index("ix_usage_event_owner_at", "owner_id", "at"),
    )

    kind: str = Field(sa_type=String(10))  # type: ignore
    # When it happened on the phone; created_at is when the server got it.
    at: datetime = Field(sa_type=tstz())  # type: ignore
    # share_card only: which card.
    detail: str | None = Field(default=None, sa_type=String(DETAIL_MAX))  # type: ignore
