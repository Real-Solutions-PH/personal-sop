"""Invite links: create, list, revoke, preview and accept.

A link is ``<public origin>/i/<token>``: 32 URL-safe characters (192 random
bits) from ``secrets``, stored only as a SHA-256. It works once, for seven
days, until its maker revokes it. Opening it never needs the two people to
be connected: holding the link is the permission, which is why it is
single-use and short-lived.

Authorization: only who may share the thing (the kind's ``check_inviter``)
makes, lists or revokes its links; anyone else gets the kind's 404. A token
that matches no link in the caller's tenant is ``invite_not_found``.
Accepting checks, in order: the caller made it (409 ``own_invite``); the
caller is already in (nothing consumed); revoked, used, expired (410 with
``invite_revoked`` / ``invite_used`` / ``invite_expired``).
"""

import hashlib
import secrets
import uuid
from datetime import timedelta

from sqlmodel import col, select

from app.modules.invites import registry
from app.modules.invites.models import Invite
from app.modules.invites.schema import (
    InviteAccepted,
    InviteCreated,
    InviteOut,
    InvitePerson,
    InvitePreview,
    InvitesOut,
    InviteState,
)
from app.modules.social import public as social
from app.shared.context import Ctx
from app.shared.domain import conflict, domain_error, not_found

TTL = timedelta(days=7)
# Open links one thing may have at once: plenty for a family, and a bound
# on what a stolen session could mint.
MAX_OPEN = 20
LINK_PATH = "/i/"


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def new_token() -> str:
    return secrets.token_urlsafe(24)


def link_url(origin: str, token: str) -> str:
    return f"{origin.rstrip('/')}{LINK_PATH}{token}"


def _out(i: Invite) -> InviteOut:
    return InviteOut(
        id=i.id,
        kind=i.kind,
        object_id=i.object_id,
        created_at=i.created_at,
        expires_at=i.expires_at,
        used_at=i.used_at,
        revoked_at=i.revoked_at,
    )


def _open_links(ctx: Ctx, kind: str, object_id: uuid.UUID) -> list[Invite]:
    return list(
        ctx.session.exec(
            select(Invite)
            .where(
                Invite.kind == kind,
                Invite.object_id == object_id,
                Invite.tenant_id == ctx.tenant_id,
                col(Invite.used_at).is_(None),
                col(Invite.revoked_at).is_(None),
                col(Invite.deleted_at).is_(None),
                col(Invite.expires_at) > ctx.now,
            )
            .order_by(col(Invite.created_at).desc(), col(Invite.id))
        ).all()
    )


def create_invite(
    ctx: Ctx, *, kind: str, object_id: uuid.UUID, origin: str
) -> InviteCreated:
    k = registry.get(kind)
    k.check_inviter(ctx, object_id)
    if len(_open_links(ctx, kind, object_id)) >= MAX_OPEN:
        raise conflict("too_many_invites", "Revoke an unused link first")
    token = new_token()
    row = Invite(
        **ctx.owned(),
        kind=kind,
        object_id=object_id,
        token_hash=hash_token(token),
        created_at=ctx.now,
        updated_at=ctx.now,
        expires_at=ctx.now + TTL,
    )
    ctx.session.add(row)
    ctx.commit()
    return InviteCreated(
        **_out(row).model_dump(), token=token, url=link_url(origin, token)
    )


def list_invites(ctx: Ctx, *, kind: str, object_id: uuid.UUID) -> InvitesOut:
    """The links still waiting to be used (any maker who may share it)."""
    registry.get(kind).check_inviter(ctx, object_id)
    return InvitesOut(data=[_out(i) for i in _open_links(ctx, kind, object_id)])


def revoke_invite(ctx: Ctx, *, invite_id: uuid.UUID) -> InviteOut:
    row = ctx.session.exec(
        select(Invite)
        .where(
            Invite.id == invite_id,
            Invite.tenant_id == ctx.tenant_id,
            col(Invite.deleted_at).is_(None),
        )
        .with_for_update()
    ).first()
    if row is None:
        raise not_found("invite")
    registry.get(row.kind).check_inviter(ctx, row.object_id)
    if row.revoked_at is None and row.used_at is None:
        row.revoked_at = ctx.now
        row.updated_at = ctx.now
        ctx.session.add(row)
    ctx.commit()
    return _out(row)


def _by_token(ctx: Ctx, token: str, *, lock: bool = False) -> Invite:
    if not token or len(token) > 64:
        raise not_found("invite")
    q = select(Invite).where(
        Invite.token_hash == hash_token(token),
        Invite.tenant_id == ctx.tenant_id,
        col(Invite.deleted_at).is_(None),
    )
    if lock:
        q = q.with_for_update()
    row = ctx.session.exec(q).first()
    if row is None:
        raise not_found("invite")
    return row


def _dead_state(ctx: Ctx, row: Invite) -> InviteState | None:
    if row.revoked_at is not None:
        return "revoked"
    if row.used_at is not None:
        return "used"
    if row.expires_at <= ctx.now:
        return "expired"
    return None


def _person(ctx: Ctx, user_id: uuid.UUID) -> InvitePerson:
    b = social.briefs(ctx, [user_id]).get(user_id)
    if b is None:
        return InvitePerson(id=user_id, name="Someone")
    return InvitePerson(
        id=user_id,
        name=b.name or "Someone",
        handle=b.handle,
        photo_media_id=b.photo_media_id,
    )


def preview(ctx: Ctx, *, token: str) -> InvitePreview:
    """What opening the link shows. A dead link names nothing but who sent
    it and why it no longer works."""
    row = _by_token(ctx, token)
    k = registry.get(row.kind)
    state: InviteState | None
    if row.owner_id == ctx.user_id:
        state = "own"
    elif k.is_member(ctx, row.object_id):
        state = "member"
    else:
        state = _dead_state(ctx, row) or "open"
    subject = k.describe(ctx, row) if state in ("open", "member", "own") else None
    return InvitePreview(
        state=state,
        kind=row.kind,
        expires_at=row.expires_at,
        inviter=_person(ctx, row.owner_id),
        subject=subject,
    )


def gone(code: str, message: str) -> Exception:
    return domain_error(410, code, message)


DEAD = {
    "revoked": ("invite_revoked", "This invite was cancelled"),
    "used": ("invite_used", "This invite was already used"),
    "expired": ("invite_expired", "This invite has expired"),
}


def accept(ctx: Ctx, *, token: str) -> InviteAccepted:
    row = _by_token(ctx, token, lock=True)
    k = registry.get(row.kind)
    if row.owner_id == ctx.user_id:
        raise conflict("own_invite", "This is your own invite")
    if k.is_member(ctx, row.object_id):
        subject = k.describe(ctx, row)
        ctx.commit()
        return InviteAccepted(
            kind=row.kind, object_id=row.object_id, href=subject.href, joined=False
        )
    dead = _dead_state(ctx, row)
    if dead is not None:
        raise gone(*DEAD[dead])
    subject = k.describe(ctx, row)
    k.accept(ctx, row)
    row.used_at = ctx.now
    row.used_by = ctx.user_id
    row.updated_at = ctx.now
    ctx.session.add(row)
    ctx.commit()
    return InviteAccepted(
        kind=row.kind, object_id=row.object_id, href=subject.href, joined=True
    )
