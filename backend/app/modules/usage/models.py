"""App usage events: when the app comes to the foreground or leaves it,
when a share card is shared, when a notification is tapped (push_open), and
the Unfurl Plus moments (the paywall shown,
a purchase started, purchases restored on the phone; purchased, cancelled
and refunded as RevenueCat reports them to the server). They answer what
the record tables cannot: how often people open Unfurl, how long they stay,
how many cards they share (docs/25-retention-kpis.md) and how the paywall
converts.

A row carries the kind, the moment on the phone (for the server's own kinds,
RevenueCat's) and, for a share, the card's key; a Plus kind may carry the
product (a fixed identifier, never text the person typed). Owned and
tenant-scoped like every record, so erasure and RLS cover it. Append-only by
convention: the code only inserts. Not synced to the phone.
"""

from datetime import datetime

from sqlalchemy import CheckConstraint, Index, String
from sqlmodel import Field

from app.shared.owned import OwnedRow, enum_check, tstz

# Sent by the phone.
PHONE_KINDS = (
    "app_open",
    "app_close",
    "share_card",
    "paywall_shown",
    "purchase_started",
    "restored",
    "push_open",
)
# Written only by the server, from RevenueCat webhooks.
SERVER_KINDS = ("purchased", "cancelled", "refunded")
KINDS = (*PHONE_KINDS, *SERVER_KINDS)
KIND_MAX = 16
DETAIL_MAX = 40
DETAIL_RULE = (
    "(kind NOT IN ('share_card', 'push_open') OR detail IS NOT NULL)"
    " AND (kind NOT IN ('app_open', 'app_close') OR detail IS NULL)"
)


class UsageEvent(OwnedRow, table=True):
    __tablename__ = "usage_event"
    __table_args__ = (
        enum_check("kind", KINDS, name="ck_usage_event_kind"),
        CheckConstraint(DETAIL_RULE, name="ck_usage_event_detail"),
        Index("ix_usage_event_owner_at", "owner_id", "at"),
    )

    kind: str = Field(sa_type=String(KIND_MAX))  # type: ignore
    # When it happened on the phone; created_at is when the server got it.
    at: datetime = Field(sa_type=tstz())  # type: ignore
    # share_card: which card (required); a Plus kind: which product;
    # push_open (required): the server notification's id for a push the
    # server sent (a nudge among them), else the local reminder's category.
    detail: str | None = Field(default=None, sa_type=String(DETAIL_MAX))  # type: ignore
