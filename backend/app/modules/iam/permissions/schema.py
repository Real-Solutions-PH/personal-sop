import uuid
from datetime import datetime

from sqlmodel import SQLModel


class PermissionPublic(SQLModel):
    id: uuid.UUID
    name: str
    resource: str
    action: str
    description: str | None = None
    created_at: datetime | None = None


class PermissionsPublic(SQLModel):
    data: list[PermissionPublic]
    count: int
