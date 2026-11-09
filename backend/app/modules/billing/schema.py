import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict

Plan = Literal["free", "plus"]


class PlanPublic(BaseModel):
    """The plan in force now, as the server decides it."""

    plan: Plan
    plus_until: datetime | None
    will_renew: bool


class EntitlementPublic(BaseModel):
    """The synced row. ``plan`` is the stored one: Plus is in force while
    ``plan`` is "plus" and ``plus_until`` is empty or still ahead."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    plan: Plan
    plus_until: datetime | None
    will_renew: bool
    product_id: str | None
    version: int


class NoPush(BaseModel):
    """The plan is never written from a phone."""
