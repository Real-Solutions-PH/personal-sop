"""Invite links: one row per link, for any shareable thing.

``owner_id`` made the link; ``kind`` + ``object_id`` name what it invites to
(a kind is registered by the module that owns the thing, see
``registry``). The token itself is never stored: ``token_hash`` is its
SHA-256, so a database read cannot be turned into a working link.

A link is single-use: ``used_at``/``used_by`` are set once, by the accept
that consumed it. ``revoked_at`` ends it early. Neither is ever cleared.
"""

import uuid
from datetime import datetime

from sqlalchemy import CheckConstraint, Index, String, UniqueConstraint
from sqlmodel import Field

from app.shared.owned import OwnedRow, tstz


class Invite(OwnedRow, table=True):
    __tablename__ = "invite"
    __table_args__ = (
        UniqueConstraint("token_hash", name="uq_invite_token_hash"),
        Index("ix_invite_object", "kind", "object_id"),
        # Used is all or nothing: when and by whom.
        CheckConstraint(
            "(used_at IS NULL) = (used_by IS NULL)", name="ck_invite_used_together"
        ),
        CheckConstraint("expires_at > created_at", name="ck_invite_expiry"),
    )

    kind: str = Field(sa_type=String(24))  # type: ignore
    object_id: uuid.UUID
    token_hash: str = Field(sa_type=String(64))  # type: ignore
    expires_at: datetime = Field(sa_type=tstz())  # type: ignore
    used_at: datetime | None = Field(default=None, sa_type=tstz())  # type: ignore
    used_by: uuid.UUID | None = Field(
        default=None, foreign_key="user.id", ondelete="SET NULL"
    )
    revoked_at: datetime | None = Field(default=None, sa_type=tstz())  # type: ignore
