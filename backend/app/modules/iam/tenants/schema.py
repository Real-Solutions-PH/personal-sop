import uuid
from datetime import datetime

from sqlmodel import SQLModel


class TenantPublic(SQLModel):
    id: uuid.UUID
    name: str
    slug: str
    is_active: bool
    created_at: datetime | None = None


class TenantsPublic(SQLModel):
    data: list[TenantPublic]
    count: int
