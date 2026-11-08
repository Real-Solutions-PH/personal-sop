from fastapi import APIRouter, Depends

from app.modules.iam.deps import require_permission
from app.modules.usage import services
from app.modules.usage.schema import UsageAccepted, UsageBatch
from app.shared.context import CtxDep
from app.shared.rate_limit import rate_limited

router = APIRouter(prefix="/usage", tags=["usage"])

WRITE = [rate_limited("usage"), Depends(require_permission("usage:write"))]


@router.post("/events", response_model=UsageAccepted, dependencies=WRITE)
def post_events(ctx: CtxDep, body: UsageBatch) -> UsageAccepted:
    return UsageAccepted(accepted=services.record(ctx, body))
