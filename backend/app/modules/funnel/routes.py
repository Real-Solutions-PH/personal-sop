from fastapi import APIRouter

from app.modules.funnel import services
from app.modules.funnel.schema import FunnelAccepted, FunnelBatch
from app.shared.deps import SessionDep
from app.shared.rate_limit import rate_limited_by_client

router = APIRouter(prefix="/funnel", tags=["funnel"])


# Public: most onboarding steps happen before the account exists, so there
# is no token to check. Limited per client address; the body carries only a
# random install id and fixed step and module names.
@router.post(
    "/events",
    response_model=FunnelAccepted,
    dependencies=[rate_limited_by_client("funnel")],
)
def post_events(session: SessionDep, body: FunnelBatch) -> FunnelAccepted:
    return FunnelAccepted(accepted=services.record(session, body))
