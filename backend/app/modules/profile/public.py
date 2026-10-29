"""Cross-module contract of the profile module (implemented by profile)."""

from dataclasses import dataclass
from typing import Literal

from sqlmodel import select

from app.modules.profile.models import LiveSession, ModulePref, UserProfile
from app.shared import owned_repo
from app.shared.context import Ctx
from app.shared.domain import conflict

ModuleKey = Literal[
    "habits", "tasks", "fitness", "nutrition", "focus", "finance", "screen"
]
DEFAULT_WEIGHTS: dict[str, int] = {
    "habits": 3,
    "tasks": 2,
    "fitness": 3,
    "nutrition": 2,
    "focus": 2,
    "finance": 2,
    "screen": 2,
}


@dataclass(frozen=True)
class ModuleSetting:
    enabled: bool
    weight: int


def get_profile(ctx: Ctx) -> UserProfile:
    """The caller's profile, created with defaults on first access."""
    row = owned_repo.find_one(ctx, UserProfile, include_deleted=True)
    if row is None:
        row = owned_repo.insert(
            ctx, UserProfile, {"name": ctx.user.full_name or "", "since": ctx.today}
        )
    return row


def module_settings(ctx: Ctx) -> dict[str, ModuleSetting]:
    """Enabled flag + Life Score weight for all four modules (defaults
    ``DEFAULT_WEIGHTS``, all enabled, when the user never changed them)."""
    out = {k: ModuleSetting(enabled=True, weight=w) for k, w in DEFAULT_WEIGHTS.items()}
    for pref in owned_repo.list_rows(ctx, ModulePref):
        out[pref.module] = ModuleSetting(enabled=pref.enabled, weight=pref.weight)
    return out


def get_live(ctx: Ctx) -> LiveSession | None:
    return owned_repo.find_one(ctx, LiveSession)


def start_live(
    ctx: Ctx,
    *,
    kind: Literal["timer", "routine", "workout"],
    label: str,
    href: str,
    ref_id: object,
) -> LiveSession:
    """Claim the Live bar. Raises 409 ``live_session_busy`` (details: the
    current session) when something else is already running."""
    current = ctx.session.exec(
        select(LiveSession).where(LiveSession.owner_id == ctx.user_id)
    ).first()
    if current is not None and current.deleted_at is None:
        if current.kind == kind and current.ref_id == ref_id:
            return current
        raise conflict(
            "live_session_busy",
            "Something else is already running",
            {"kind": current.kind, "label": current.label, "href": current.href},
        )
    data = {
        "kind": kind,
        "label": label,
        "href": href,
        "ref_id": ref_id,
        "started_at": ctx.now,
        "paused_at": None,
        "paused_sec": 0,
    }
    if current is not None:  # revive the user's single row
        owned_repo.apply(current, data)
        current.deleted_at = None
        ctx.session.add(current)
        ctx.session.flush()
        return current
    return owned_repo.insert(ctx, LiveSession, data)


def pause_live(ctx: Ctx) -> LiveSession | None:
    live = get_live(ctx)
    if live is not None and live.paused_at is None:
        live.paused_at = ctx.now
        ctx.session.add(live)
        ctx.session.flush()
    return live


def resume_live(ctx: Ctx) -> LiveSession | None:
    live = get_live(ctx)
    if live is not None and live.paused_at is not None:
        live.paused_sec += int((ctx.now - live.paused_at).total_seconds())
        live.paused_at = None
        ctx.session.add(live)
        ctx.session.flush()
    return live


def update_live_label(ctx: Ctx, *, kind: str, ref_id: object, label: str) -> None:
    """Relabel the Live bar ("Push A · 3/15 sets") if this kind/ref holds it.
    Flushes only."""
    live = get_live(ctx)
    if live is not None and live.kind == kind and live.ref_id == ref_id:
        if live.label != label:
            live.label = label[:120]
            ctx.session.add(live)
            ctx.session.flush()


def end_live(ctx: Ctx, *, kind: str, ref_id: object) -> None:
    """Release the Live bar if (and only if) it holds this kind/ref."""
    live = get_live(ctx)
    if live is not None and live.kind == kind and live.ref_id == ref_id:
        owned_repo.soft_delete(ctx, live)
