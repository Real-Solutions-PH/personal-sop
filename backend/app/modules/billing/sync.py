"""Sync registration for billing: the plan row is pulled, never pushed."""

from app.modules.billing.models import Entitlement
from app.modules.billing.schema import EntitlementPublic, NoPush
from app.modules.sync.registry import Entity, Registry


def register(r: Registry) -> None:
    r.entity(
        Entity(
            name="entitlement",
            model=Entitlement,
            payload=NoPush,
            public=EntitlementPublic,
            read_only=True,
        )
    )
