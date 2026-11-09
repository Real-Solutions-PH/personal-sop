"""The account's plan: free, or Unfurl Plus until a moment.

One row per person, written only by the server from what RevenueCat says
(its webhooks, and a refresh that asks RevenueCat's REST API); the phone
pulls it through sync and never writes it. A person with no row is free.

``plan`` is what the newest RevenueCat news said; whether Plus is in force
NOW also needs ``plus_until`` (``public.plan_of``), so a cancelled
subscription lapses to free when its paid period ends with no further event.
"""

from datetime import datetime

from sqlalchemy import BigInteger, String, UniqueConstraint
from sqlmodel import Field

from app.shared.owned import OwnedRow, enum_check, tstz

PLANS = ("free", "plus")
ENVIRONMENTS = ("sandbox", "production")


class Entitlement(OwnedRow, table=True):
    __tablename__ = "entitlement"
    __table_args__ = (
        UniqueConstraint("owner_id", name="uq_entitlement_owner"),
        enum_check("plan", PLANS, name="ck_entitlement_plan"),
        enum_check("environment", ENVIRONMENTS, name="ck_entitlement_environment"),
    )

    plan: str = Field(
        default="free",
        sa_type=String(8),  # type: ignore
        sa_column_kwargs={"server_default": "free"},
    )
    # When the paid period ends (refunds: when it was refunded). NULL with
    # plan "plus" means no end date.
    plus_until: datetime | None = Field(default=None, sa_type=tstz())  # type: ignore
    # False once the person turned renewal off or the store refunded it.
    will_renew: bool = Field(
        default=False, sa_column_kwargs={"server_default": "false"}
    )
    product_id: str | None = Field(default=None, sa_type=String(64))  # type: ignore
    environment: str | None = Field(default=None, sa_type=String(12))  # type: ignore
    # The newest RevenueCat news applied (epoch ms): older news delivered
    # later never winds the plan back.
    last_event_ms: int | None = Field(default=None, sa_type=BigInteger)
