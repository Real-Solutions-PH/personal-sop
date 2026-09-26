import uuid
from datetime import datetime, timezone
from typing import TYPE_CHECKING

from sqlalchemy import DateTime
from sqlmodel import Field, Relationship

from app.modules.iam.users.schema import UserBase

if TYPE_CHECKING:
    from app.modules.items.models import Item


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class User(UserBase, table=True):
    # PK == Supabase auth UID (JWT ``sub``) for rows provisioned from tokens;
    # the uuid4 default only serves direct test fixtures.
    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    # RESTRICT: a tenant with users must not be deletable out from under them.
    tenant_id: uuid.UUID = Field(
        foreign_key="tenant.id", nullable=False, ondelete="RESTRICT", index=True
    )
    created_at: datetime | None = Field(
        default_factory=_utcnow,
        sa_type=DateTime(timezone=True),  # type: ignore
    )
    # Soft-delete marker (retention convention): non-null == logically
    # deleted. Erasure (GDPR right-to-erasure) is a separate hard delete —
    # see app.modules.iam.users.services and docs/data-protection.md.
    deleted_at: datetime | None = Field(
        default=None,
        sa_type=DateTime(timezone=True),  # type: ignore
        index=True,
    )
    items: list["Item"] = Relationship(back_populates="owner", cascade_delete=True)
