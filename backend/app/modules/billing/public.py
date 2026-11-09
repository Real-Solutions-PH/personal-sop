"""What other modules may ask about the plan (the Fern allowance reads it)."""

import uuid
from datetime import datetime

from sqlmodel import Session

from app.modules.billing import services
from app.modules.billing.schema import PlanPublic


def plan_of(session: Session, owner_id: uuid.UUID, now: datetime | None = None) -> str:
    """ "plus" while Unfurl Plus is in force for this person, else "free"."""
    return services.plan_of(session, owner_id, now)


def view(
    session: Session, owner_id: uuid.UUID, now: datetime | None = None
) -> PlanPublic:
    """The plan in force, its end and whether it renews."""
    return services.view(session, owner_id, now)
