from app.modules.usage.models import UsageEvent
from app.modules.usage.schema import UsageBatch
from app.shared.context import Ctx


def record(ctx: Ctx, batch: UsageBatch) -> int:
    """Insert one row per event for the caller; the whole batch or none."""
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
    ctx.commit()
    return len(batch.events)
