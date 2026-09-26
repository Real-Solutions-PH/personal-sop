import uuid
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import DateTime
from sqlalchemy.dialects.postgresql import JSONB
from sqlmodel import Column, Field, SQLModel


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class AuditLog(SQLModel, table=True):
    """Append-only forensic trail of privileged/mutating actions.

    One row per privileged action (who did what to which target, and how the
    target changed). Written from the service layer inside the same request
    that performs the mutation.

    Deliberately has NO foreign keys: an audit entry must outlive the actor
    and the target it describes (deleting a user must not erase the record of
    who deleted it). ``target_id`` is a string so it can hold any id shape.
    Not tenant-scoped and RLS stays off — this is a platform-admin log, in
    line with the other global catalog tables.

    Append-only is a convention, not a DB grant here: the code only ever
    inserts. Never expose update/delete paths over this table.
    """

    __tablename__ = "auditlog"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    # None = system/unattributed action (actor not plumbed through to the
    # service yet — see app.modules.audit.services.record).
    actor_id: uuid.UUID | None = Field(default=None, index=True)
    action: str = Field(max_length=128, index=True)  # e.g. "user.delete"
    target_type: str = Field(max_length=64, index=True)  # e.g. "user"
    target_id: str | None = Field(default=None, max_length=255, index=True)
    before: dict[str, Any] | None = Field(
        default=None, sa_column=Column(JSONB, nullable=True)
    )
    after: dict[str, Any] | None = Field(
        default=None, sa_column=Column(JSONB, nullable=True)
    )
    created_at: datetime = Field(
        default_factory=_utcnow,
        sa_type=DateTime(timezone=True),  # type: ignore[call-overload]
    )
