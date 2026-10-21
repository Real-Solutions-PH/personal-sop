"""Sync receipts: each pushed op is applied at most once."""

import uuid
from datetime import datetime

from sqlalchemy import String
from sqlmodel import Field, SQLModel

from app.shared.owned import JSONB, tstz, utcnow


class SyncOpReceipt(SQLModel, table=True):
    """``(owner_id, op_id)`` is the idempotency key for a pushed op. The
    stored ``result`` is returned verbatim on replay."""

    __tablename__ = "sync_op_receipt"

    owner_id: uuid.UUID = Field(
        foreign_key="user.id", ondelete="CASCADE", primary_key=True
    )
    op_id: uuid.UUID = Field(primary_key=True)
    tenant_id: uuid.UUID = Field(
        foreign_key="tenant.id", ondelete="CASCADE", index=True
    )
    entity: str = Field(max_length=40)
    status: str = Field(sa_type=String(10))  # type: ignore
    result: dict[str, object] = Field(default_factory=dict, sa_type=JSONB)
    applied_at: datetime = Field(default_factory=utcnow, sa_type=tstz(), index=True)  # type: ignore
