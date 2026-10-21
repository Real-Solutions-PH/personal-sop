from fastapi import APIRouter, Depends, Query

from app.modules.iam.deps import require_permission
from app.modules.sync import services
from app.modules.sync.schema import SyncPull, SyncPush, SyncPushResult
from app.shared.context import CtxDep
from app.shared.events import publish
from app.shared.rate_limit import rate_limited

router = APIRouter(prefix="/sync", tags=["sync"])


@router.post(
    "/push",
    response_model=SyncPushResult,
    dependencies=[rate_limited("sync"), Depends(require_permission("sync:write"))],
)
def push(ctx: CtxDep, body: SyncPush) -> SyncPushResult:
    result = services.push(ctx, body.ops)
    if any(r.status == "applied" and not r.replayed for r in result.results):
        # Nudge the user's other devices to pull.
        publish(ctx.user_id, "sync.changed", {"cursor": result.cursor})
    return result


@router.get(
    "/pull",
    response_model=SyncPull,
    dependencies=[Depends(require_permission("sync:read"))],
)
def pull(
    ctx: CtxDep,
    cursor: int = Query(default=0, ge=0),
    limit: int = Query(default=500, ge=1, le=1000),
) -> SyncPull:
    return services.pull(ctx, cursor, limit)


@router.get(
    "/entities",
    response_model=list[str],
    dependencies=[Depends(require_permission("sync:read"))],
)
def entities() -> list[str]:
    return services.entity_names()
