import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

# open: can be accepted. member: the viewer is already in it (accepting
# consumes nothing). own: the viewer made the link.
InviteState = Literal["open", "used", "expired", "revoked", "member", "own"]


class InviteCreate(BaseModel):
    kind: str = Field(min_length=1, max_length=24)
    object_id: uuid.UUID


class InvitePerson(BaseModel):
    id: uuid.UUID
    name: str
    handle: str | None = None
    photo_media_id: uuid.UUID | None = None


class InviteSubject(BaseModel):
    """What the accept screen shows: written by the kind's module."""

    # e.g. "BPI Savings"
    title: str
    # e.g. "Joint account"
    label: str
    # What joining means, one short line each.
    points: list[str] = Field(default_factory=list)
    # Where the app opens once joined.
    href: str


class InviteOut(BaseModel):
    """A link as its maker sees it (the token is never shown again)."""

    id: uuid.UUID
    kind: str
    object_id: uuid.UUID
    created_at: datetime
    expires_at: datetime
    used_at: datetime | None = None
    revoked_at: datetime | None = None


class InviteCreated(InviteOut):
    """Returned once, on create: the only time the token is readable."""

    token: str
    url: str


class InvitesOut(BaseModel):
    data: list[InviteOut]


class InvitePreview(BaseModel):
    state: InviteState
    kind: str
    expires_at: datetime
    inviter: InvitePerson
    # None when the link can no longer be used (nothing about the thing is
    # shown to someone holding a dead link).
    subject: InviteSubject | None = None


class InviteAccepted(BaseModel):
    kind: str
    object_id: uuid.UUID
    href: str
    # False: they were already in it and the link was left unused.
    joined: bool
