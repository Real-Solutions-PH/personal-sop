import uuid
from datetime import datetime

from sqlmodel import SQLModel


class RolePublic(SQLModel):
    id: uuid.UUID
    name: str
    description: str | None = None
    created_at: datetime | None = None


class RolesPublic(SQLModel):
    data: list[RolePublic]
    count: int
