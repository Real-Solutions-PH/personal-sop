import uuid

from app.modules.retention import public as retention
from app.modules.usage.models import UsageEvent
from app.modules.usage.schema import UsageBatch
from app.shared.context import Ctx


def _notification_id(detail: str | None) -> uuid.UUID | None:
    try:
        return uuid.UUID(detail) if detail else None
    except ValueError:
        return None


def record(ctx: Ctx, batch: UsageBatch) -> int:
    """Insert one row per event for the caller; the whole batch or none. A
    tapped push that was a nudge stamps the nudge's ``opened_at``."""
    ctx.session.add_all(
        UsageEvent(
            owner_id=ctx.user_id,
            tenant_id=ctx.tenant_id,
            kind=e.kind,
            at=e.at,
            detail=e.detail,
        )
        for e in batch.events
    )
    for e in batch.events:
        nid = _notification_id(e.detail) if e.kind == "push_open" else None
        if nid is not None:
            retention.record_open(ctx, nid, e.at)
    ctx.commit()
    return len(batch.events)
