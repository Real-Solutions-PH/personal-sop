from fastapi import APIRouter, Depends

from app.modules.iam.deps import require_permission
from app.modules.profile import public as profile_public
from app.modules.retention import sender
from app.modules.retention.models import RetentionProfile
from app.modules.retention.schema import NudgeSettings
from app.shared import owned_repo
from app.shared.context import CtxDep

router = APIRouter(prefix="/retention", tags=["retention"])

READ = [Depends(require_permission("profile:read"))]


@router.get("/nudge", response_model=NudgeSettings, dependencies=READ)
def get_nudge(ctx: CtxDep) -> NudgeSettings:
    profile = profile_public.get_profile(ctx)
    rp = owned_repo.find_one(ctx, RetentionProfile)
    mode = (
        profile.nudge_mode
        if profile.nudge_mode in ("daily", "weekly", "off")
        else "daily"
    )
    return NudgeSettings(
        mode=mode,  # type: ignore[arg-type]
        pinned=profile.nudge_time,
        usual=sender.usual_time(rp, ctx.today),
    )
