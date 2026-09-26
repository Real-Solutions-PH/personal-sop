import uuid
from datetime import datetime
from typing import Any

from sqlmodel import SQLModel


class AuditLogPublic(SQLModel):
    """One audit row as returned over the API.

    ``before``/``after`` are the snapshots captured at write time via
    ``audit.snapshot``, which is an explicit non-secret allow-list — so they
    carry no credentials or connection secrets (MCP/tool ``config`` is never
    captured) and are safe to expose to an ``audit:read`` holder.
    """

    id: uuid.UUID
    actor_id: uuid.UUID | None
    action: str
    target_type: str
    target_id: str | None
    before: dict[str, Any] | None
    after: dict[str, Any] | None
    created_at: datetime


class AuditLogsPublic(SQLModel):
    data: list[AuditLogPublic]
    count: int
