from fastapi import APIRouter, Depends

from app.modules.billing import services
from app.modules.billing.schema import PlanPublic
from app.modules.iam.deps import CurrentUser, require_permission
from app.shared.deps import SessionDep
from app.shared.rate_limit import guarded

router = APIRouter(prefix="/billing", tags=["billing"])


@router.get(
    "/plan",
    response_model=PlanPublic,
    dependencies=[Depends(require_permission("billing:read"))],
)
def read_plan(session: SessionDep, current_user: CurrentUser) -> PlanPublic:
    return services.view(session, current_user.id)


@router.post(
    "/refresh",
    response_model=PlanPublic,
    dependencies=[
        # Per person and per address (the tenant-wide budget is off in
        # production): each call waits on RevenueCat.
        guarded("account", "billing-refresh"),
        Depends(require_permission("billing:read")),
    ],
)
def refresh_plan(session: SessionDep, current_user: CurrentUser) -> PlanPublic:
    """Ask RevenueCat what this account holds and store it (app start, and
    right after a purchase or a restore). The phone sends nothing: the
    answer comes from RevenueCat, never from the device."""
    return services.refresh(session, current_user)
