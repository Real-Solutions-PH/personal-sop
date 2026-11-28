"""Invite-link REST routes. What a link invites to (``kind``) is registered
by the module that owns the thing; see ``registry``."""

import uuid
from typing import Any

from fastapi import APIRouter, Depends, Query, Request

from app.modules.iam.deps import require_permission
from app.modules.invites import services
from app.modules.invites.page import public_origin
from app.modules.invites.schema import (
    InviteAccepted,
    InviteCreate,
    InviteCreated,
    InviteOut,
    InvitePreview,
    InvitesOut,
)
from app.shared.context import CtxDep
from app.shared.rate_limit import rate_limited

router = APIRouter(prefix="/invites", tags=["invites"])

READ = [Depends(require_permission("social:read"))]
WRITE = [rate_limited("social"), Depends(require_permission("social:write"))]


@router.post("", response_model=InviteCreated, dependencies=WRITE)
def create_invite(ctx: CtxDep, data: InviteCreate, request: Request) -> Any:
    """A new single-use link (7 days). The token is only readable here."""
    return services.create_invite(
        ctx, kind=data.kind, object_id=data.object_id, origin=public_origin(request)
    )


@router.get("", response_model=InvitesOut, dependencies=READ)
def list_invites(
    ctx: CtxDep,
    kind: str = Query(min_length=1, max_length=24),
    object_id: uuid.UUID = Query(),
) -> Any:
    """Links to one thing still waiting to be used."""
    return services.list_invites(ctx, kind=kind, object_id=object_id)


@router.post("/{invite_id}/revoke", response_model=InviteOut, dependencies=WRITE)
def revoke_invite(ctx: CtxDep, invite_id: uuid.UUID) -> Any:
    return services.revoke_invite(ctx, invite_id=invite_id)


@router.get("/token/{token}", response_model=InvitePreview, dependencies=READ)
def preview(ctx: CtxDep, token: str) -> Any:
    """What opening a link shows, including why a dead one doesn't work."""
    return services.preview(ctx, token=token)


@router.post("/token/{token}/accept", response_model=InviteAccepted, dependencies=WRITE)
def accept(ctx: CtxDep, token: str) -> Any:
    return services.accept(ctx, token=token)
