"""What an invite link can invite to.

A module that owns a shareable thing registers one ``InviteKind`` at import
time (``register``); the invites module never knows the thing itself. Every
hook gets the caller's ``Ctx`` and must do its own authorization:

- ``check_inviter(ctx, object_id)``: raise (a 404 for a thing the caller may
  not invite to, so its existence isn't confirmed) unless ``ctx`` may hand
  out links to it. Called on create and when listing or revoking links.
- ``describe(ctx, invite)``: what the accept screen shows the person who
  opened the link. Raise a 404 when the thing is gone.
- ``is_member(ctx, object_id)``: already in it. Accepting then consumes
  nothing.
- ``accept(ctx, invite)``: make ``ctx``'s user a member. Flush only; the
  invites service marks the link used and commits once.
"""

import uuid
from collections.abc import Callable
from dataclasses import dataclass

from app.modules.invites.models import Invite
from app.modules.invites.schema import InviteSubject
from app.shared.context import Ctx
from app.shared.domain import invalid


@dataclass(frozen=True)
class InviteKind:
    name: str
    check_inviter: Callable[[Ctx, uuid.UUID], None]
    describe: Callable[[Ctx, Invite], InviteSubject]
    is_member: Callable[[Ctx, uuid.UUID], bool]
    accept: Callable[[Ctx, Invite], None]


_KINDS: dict[str, InviteKind] = {}


def register(kind: InviteKind) -> None:
    if len(kind.name) > 24:
        raise ValueError(f"invite kind name too long: {kind.name}")
    _KINDS[kind.name] = kind


def get(name: str) -> InviteKind:
    """The registered kind; an unknown one is a 422, never a fall-through."""
    k = _KINDS.get(name)
    if k is None:
        raise invalid("invite_kind_unknown", "That can't be shared by link")
    return k


def names() -> list[str]:
    return sorted(_KINDS)
