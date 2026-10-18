"""Cross-module contract of the profile module (implemented by profile)."""

from dataclasses import dataclass
from typing import Literal

from app.modules.profile.models import LiveSession, UserProfile
from app.shared.context import Ctx

ModuleKey = Literal["habits", "tasks", "fitness", "finance"]
DEFAULT_WEIGHTS: dict[str, int] = {"habits": 3, "tasks": 2, "fitness": 3, "finance": 2}


@dataclass(frozen=True)
class ModuleSetting:
    enabled: bool
    weight: int


def get_profile(ctx: Ctx) -> UserProfile:
    """The caller's profile, created with defaults on first access."""
    raise NotImplementedError


def module_settings(ctx: Ctx) -> dict[str, ModuleSetting]:
    """Enabled flag + Life Score weight for all four modules (defaults
    ``DEFAULT_WEIGHTS``, all enabled, when the user never changed them)."""
    raise NotImplementedError


def get_live(ctx: Ctx) -> LiveSession | None:
    raise NotImplementedError


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
    raise NotImplementedError


def pause_live(ctx: Ctx) -> LiveSession | None:
    raise NotImplementedError


def resume_live(ctx: Ctx) -> LiveSession | None:
    raise NotImplementedError


def end_live(ctx: Ctx, *, kind: str, ref_id: object) -> None:
    """Release the Live bar if (and only if) it holds this kind/ref."""
    raise NotImplementedError
