"""Profile use cases: the Me/Settings screens, onboarding, sign-up
completion, module switches and weights, identities, the Live bar, push
devices."""

import uuid

from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, col, func, select

from app.modules.finance import public as finance_public
from app.modules.iam.tenants import services as tenant_service
from app.modules.media import public as media_public
from app.modules.profile import public
from app.modules.profile.models import (
    MODULE_KEYS,
    Identity,
    ModulePref,
    PushDevice,
    SetupSkip,
    UserProfile,
)
from app.modules.profile.schema import (
    RESERVED_HANDLES,
    CompleteSignup,
    HandleAvailability,
    HandleCheck,
    IdentityIn,
    ModulePrefPublic,
    ModulePrefUpdate,
    ProfileUpdate,
    PushDeviceIn,
    check_handle,
)
from app.modules.tasks import public as tasks_public
from app.shared import owned_repo
from app.shared.context import Ctx
from app.shared.day import DayClock
from app.shared.domain import conflict, invalid, not_found

MAX_IDENTITIES = 3


def _handle_taken(ctx: Ctx, handle: str) -> bool:
    other = ctx.session.exec(
        select(func.count())
        .select_from(UserProfile)
        .where(
            UserProfile.tenant_id == ctx.tenant_id,
            UserProfile.handle == handle,
            UserProfile.owner_id != ctx.user_id,
        )
    ).one()
    return bool(other)


def check_handle_availability(ctx: Ctx, handle: str) -> HandleCheck:
    try:
        check_handle(handle)
    except ValueError as exc:
        return HandleCheck(handle=handle, status="invalid", reason=str(exc))
    if handle in RESERVED_HANDLES or _handle_taken(ctx, handle):
        return HandleCheck(handle=handle, status="taken")
    return HandleCheck(handle=handle, status="available")


def signup_handle_availability(session: Session, handle: str) -> HandleAvailability:
    """The sign-up screen's check, asked before the person has an account.

    Compared case-insensitively against every profile in the tenant new
    sign-ups join (the default tenant), so "Kai" reads as taken when "kai"
    is held. Nothing is excluded as "yours": the caller is anonymous.
    """
    candidate = handle.strip().lower()
    try:
        check_handle(candidate)
    except ValueError:
        return HandleAvailability(status="invalid")
    if candidate in RESERVED_HANDLES:
        return HandleAvailability(status="taken")
    tenant = tenant_service.get_default_tenant(session=session)
    held = session.exec(
        select(func.count())
        .select_from(UserProfile)
        .where(
            UserProfile.tenant_id == tenant.id,
            func.lower(UserProfile.handle) == candidate,
        )
    ).one()
    return HandleAvailability(status="taken" if held else "available")


def _claim_handle(ctx: Ctx, profile: UserProfile, handle: str) -> None:
    if handle == profile.handle:
        return
    if handle in RESERVED_HANDLES or _handle_taken(ctx, handle):
        raise conflict("handle_taken", "That username is taken")
    profile.handle = handle


def handle_claimable(ctx: Ctx, handle: str) -> bool:
    """Whether the caller could take ``handle`` now (their own counts)."""
    if handle == public.get_profile(ctx).handle:
        return True
    return handle not in RESERVED_HANDLES and not _handle_taken(ctx, handle)


def _flush_unique(ctx: Ctx) -> None:
    """Flush, turning a lost uniqueness race on the handle into a 409."""
    try:
        ctx.session.flush()
    except IntegrityError as exc:
        ctx.session.rollback()
        raise conflict("handle_taken", "That username is taken") from exc


def get_profile(ctx: Ctx) -> UserProfile:
    profile = public.get_profile(ctx)
    ctx.commit()
    return profile


def update_profile(ctx: Ctx, data: ProfileUpdate) -> UserProfile:
    profile = public.get_profile(ctx)
    values = data.model_dump(exclude_unset=True)
    handle = values.pop("handle", None)
    if handle is not None:
        _claim_handle(ctx, profile, handle)
    if values.get("photo_media_id") is not None:
        # Only the caller's own, finished image: a profile photo is shown to
        # the whole tenant, so someone else's upload must never become one.
        media_public.require_ready(ctx, values["photo_media_id"], kinds=("image",))
    if "timezone" in values or "day_start_hour" in values:
        # Validate the combination before writing it.
        DayClock(
            timezone=values.get("timezone", profile.timezone),
            start_hour=values.get("day_start_hour", profile.day_start_hour),
        )
    if "seen_trophies" in values:
        # Append-only union: a device that has seen fewer must not unsee.
        values["seen_trophies"] = sorted(
            set(profile.seen_trophies) | set(values["seen_trophies"] or [])
        )
    owned_repo.apply(profile, values)
    ctx.session.add(profile)
    _flush_unique(ctx)
    ctx.commit()
    ctx.session.refresh(profile)
    return profile


def complete_signup(ctx: Ctx, data: CompleteSignup) -> UserProfile:
    profile = public.get_profile(ctx)
    _claim_handle(ctx, profile, data.handle)
    profile.name = data.name.strip()
    if data.timezone:
        DayClock(timezone=data.timezone, start_hour=profile.day_start_hour)
        profile.timezone = data.timezone
    if profile.since is None:
        profile.since = ctx.today
    # Written once: a retried sign-up never overwrites an earlier answer.
    for field in (
        "occupation",
        "occupation_detail",
        "referral_source",
        "referral_detail",
    ):
        value = getattr(data, field)
        if value is not None and getattr(profile, field) is None:
            setattr(profile, field, value)
    ctx.session.add(profile)
    _flush_unique(ctx)
    # The defaults exist from the moment the app can show finance: the
    # device's first pull follows sign-up and must carry them.
    finance_public.seed_default_categories(ctx)
    tasks_public.ensure_default_lists(ctx)
    ctx.commit()
    ctx.session.refresh(profile)
    return profile


def list_modules(ctx: Ctx) -> list[ModulePrefPublic]:
    settings = public.module_settings(ctx)
    return [
        ModulePrefPublic.model_validate(
            {"module": k, "enabled": settings[k].enabled, "weight": settings[k].weight}
        )
        for k in MODULE_KEYS
    ]


def set_module(ctx: Ctx, module: str, data: ModulePrefUpdate) -> list[ModulePrefPublic]:
    if module not in MODULE_KEYS:
        raise not_found("module")
    row = owned_repo.find_one(
        ctx, ModulePref, col(ModulePref.module) == module, include_deleted=True
    )
    current = public.module_settings(ctx)[module]
    values = {
        "module": module,
        "enabled": current.enabled if data.enabled is None else data.enabled,
        "weight": current.weight if data.weight is None else data.weight,
    }
    if row is None:
        owned_repo.insert(ctx, ModulePref, values)
    else:
        owned_repo.apply(row, values)
        row.deleted_at = None
        ctx.session.add(row)
        ctx.session.flush()
    ctx.commit()
    return list_modules(ctx)


def reset_weights(ctx: Ctx) -> list[ModulePrefPublic]:
    for row in owned_repo.list_rows(ctx, ModulePref):
        row.weight = public.DEFAULT_WEIGHTS[row.module]
        ctx.session.add(row)
    ctx.session.flush()
    ctx.commit()
    return list_modules(ctx)


def list_identities(ctx: Ctx) -> list[Identity]:
    return owned_repo.list_rows(ctx, Identity, order_by=[col(Identity.sort_order)])


def set_identities(ctx: Ctx, items: list[IdentityIn]) -> list[Identity]:
    """Replace the identity statements (at most three, in order)."""
    if len(items) > MAX_IDENTITIES:
        raise invalid("too_many_identities", "Keep it to three identity statements")
    keep: set[uuid.UUID] = set()
    for position, item in enumerate(items):
        row_id = item.id or uuid.uuid4()
        keep.add(row_id)
        owned_repo.upsert(
            ctx,
            Identity,
            row_id,
            {
                "text": item.text.strip(),
                "goal_id": item.goal_id,
                "sort_order": position,
            },
        )
    for row in list_identities(ctx):
        if row.id not in keep:
            owned_repo.soft_delete(ctx, row)
    ctx.commit()
    return list_identities(ctx)


def skip_setup(ctx: Ctx, module: str) -> list[str]:
    if module not in MODULE_KEYS:
        raise not_found("module")
    owned_repo.upsert(
        ctx, SetupSkip, uuid.uuid4(), {"module": module}, natural_key=("module",)
    )
    ctx.commit()
    return setup_skipped(ctx)


def setup_skipped(ctx: Ctx) -> list[str]:
    return sorted(r.module for r in owned_repo.list_rows(ctx, SetupSkip))


def pause_live(ctx: Ctx) -> None:
    public.pause_live(ctx)
    ctx.commit()


def resume_live(ctx: Ctx) -> None:
    public.resume_live(ctx)
    ctx.commit()


def register_push_device(ctx: Ctx, data: PushDeviceIn) -> PushDevice:
    """Idempotent on the token. A token seen under another account moves to
    this one (the phone changed hands or the user switched accounts)."""
    row = ctx.session.exec(
        select(PushDevice).where(PushDevice.token == data.token)
    ).first()
    if row is not None and row.owner_id != ctx.user_id:
        ctx.session.delete(row)
        ctx.session.flush()
        row = None
    if row is None:
        row = owned_repo.insert(
            ctx,
            PushDevice,
            {"token": data.token, "platform": data.platform, "last_seen_at": ctx.now},
        )
    else:
        row.platform = data.platform
        row.last_seen_at = ctx.now
        row.disabled_at = None
        row.deleted_at = None
        ctx.session.add(row)
        ctx.session.flush()
    ctx.commit()
    return row


def unregister_push_device(ctx: Ctx, device_id: uuid.UUID) -> None:
    row = owned_repo.require(ctx, PushDevice, device_id, what="push_device")
    owned_repo.soft_delete(ctx, row)
    ctx.commit()


def list_push_devices(ctx: Ctx) -> list[PushDevice]:
    return owned_repo.list_rows(ctx, PushDevice)
