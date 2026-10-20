import uuid

from fastapi import APIRouter, Depends, Query

from app.modules.iam.deps import require_permission
from app.modules.profile import public, services
from app.modules.profile.models import MODULE_KEYS
from app.modules.profile.schema import (
    CompleteSignup,
    HandleAvailability,
    HandleCheck,
    IdentityIn,
    IdentityPublic,
    LivePublic,
    LiveState,
    MeBundle,
    ModulePrefPublic,
    ModulePrefUpdate,
    ProfilePublic,
    ProfileUpdate,
    PushDeviceIn,
    PushDevicePublic,
)
from app.shared.context import CtxDep
from app.shared.deps import SessionDep
from app.shared.rate_limit import rate_limited, rate_limited_by_client
from app.shared.schema import Message

router = APIRouter(prefix="/profile", tags=["profile"])

READ = [Depends(require_permission("profile:read"))]
WRITE = [rate_limited("profile"), Depends(require_permission("profile:write"))]


def _live(ctx: CtxDep) -> LivePublic | None:
    live = public.get_live(ctx)
    return LivePublic.model_validate(live) if live else None


@router.get("", response_model=MeBundle, dependencies=READ)
def read_me(ctx: CtxDep) -> MeBundle:
    profile = services.get_profile(ctx)
    return MeBundle(
        profile=ProfilePublic.model_validate(profile),
        modules=services.list_modules(ctx),
        identities=[
            IdentityPublic.model_validate(i) for i in services.list_identities(ctx)
        ],
        setup_skipped=services.setup_skipped(ctx),  # type: ignore[arg-type]
        live=_live(ctx),
    )


@router.patch("", response_model=ProfilePublic, dependencies=WRITE)
def update_me(ctx: CtxDep, body: ProfileUpdate) -> ProfilePublic:
    return ProfilePublic.model_validate(services.update_profile(ctx, body))


@router.get("/handle-available", response_model=HandleCheck, dependencies=READ)
def handle_available(
    ctx: CtxDep, handle: str = Query(min_length=1, max_length=40)
) -> HandleCheck:
    return services.check_handle_availability(ctx, handle)


# Public: the sign-up screen asks before the person has an account, so there
# is no token to check. Limited per client address instead of per tenant.
@router.get(
    "/signup/handle-available",
    response_model=HandleAvailability,
    dependencies=[rate_limited_by_client("signup-handle")],
)
def signup_handle_available(
    session: SessionDep, handle: str = Query(min_length=1, max_length=40)
) -> HandleAvailability:
    return services.signup_handle_availability(session, handle)


@router.post("/complete-signup", response_model=ProfilePublic, dependencies=WRITE)
def complete_signup(ctx: CtxDep, body: CompleteSignup) -> ProfilePublic:
    return ProfilePublic.model_validate(services.complete_signup(ctx, body))


@router.get("/modules", response_model=list[ModulePrefPublic], dependencies=READ)
def read_modules(ctx: CtxDep) -> list[ModulePrefPublic]:
    return services.list_modules(ctx)


@router.patch(
    "/modules/{module}", response_model=list[ModulePrefPublic], dependencies=WRITE
)
def update_module(
    ctx: CtxDep, module: str, body: ModulePrefUpdate
) -> list[ModulePrefPublic]:
    return services.set_module(ctx, module, body)


@router.post(
    "/modules/reset-weights", response_model=list[ModulePrefPublic], dependencies=WRITE
)
def reset_weights(ctx: CtxDep) -> list[ModulePrefPublic]:
    return services.reset_weights(ctx)


@router.get("/identities", response_model=list[IdentityPublic], dependencies=READ)
def read_identities(ctx: CtxDep) -> list[IdentityPublic]:
    return [IdentityPublic.model_validate(i) for i in services.list_identities(ctx)]


@router.put("/identities", response_model=list[IdentityPublic], dependencies=WRITE)
def replace_identities(ctx: CtxDep, body: list[IdentityIn]) -> list[IdentityPublic]:
    return [
        IdentityPublic.model_validate(i) for i in services.set_identities(ctx, body)
    ]


@router.post("/setup-skips/{module}", response_model=list[str], dependencies=WRITE)
def skip_setup(ctx: CtxDep, module: str) -> list[str]:
    return services.skip_setup(ctx, module)


@router.get("/live", response_model=LiveState, dependencies=READ)
def read_live(ctx: CtxDep) -> LiveState:
    return LiveState(live=_live(ctx))


@router.post("/live/pause", response_model=LiveState, dependencies=WRITE)
def pause_live(ctx: CtxDep) -> LiveState:
    services.pause_live(ctx)
    return LiveState(live=_live(ctx))


@router.post("/live/resume", response_model=LiveState, dependencies=WRITE)
def resume_live(ctx: CtxDep) -> LiveState:
    services.resume_live(ctx)
    return LiveState(live=_live(ctx))


@router.get("/push-devices", response_model=list[PushDevicePublic], dependencies=READ)
def read_push_devices(ctx: CtxDep) -> list[PushDevicePublic]:
    return [PushDevicePublic.model_validate(d) for d in services.list_push_devices(ctx)]


@router.post("/push-devices", response_model=PushDevicePublic, dependencies=WRITE)
def register_push_device(ctx: CtxDep, body: PushDeviceIn) -> PushDevicePublic:
    return PushDevicePublic.model_validate(services.register_push_device(ctx, body))


@router.delete("/push-devices/{device_id}", dependencies=WRITE)
def unregister_push_device(ctx: CtxDep, device_id: uuid.UUID) -> Message:
    services.unregister_push_device(ctx, device_id)
    return Message(message="Device removed")


__all__ = ["router", "MODULE_KEYS"]
