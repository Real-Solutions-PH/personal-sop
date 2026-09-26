import uuid
from datetime import datetime
from typing import Any

from sqlmodel import Field, SQLModel


class AgentBase(SQLModel):
    name: str = Field(max_length=64)
    description: str | None = Field(default=None, max_length=255)
    config: dict[str, Any] = {}
    is_active: bool = True


class AgentCreate(AgentBase):
    pass


class AgentUpdate(SQLModel):
    name: str | None = Field(default=None, max_length=64)
    description: str | None = Field(default=None, max_length=255)
    config: dict[str, Any] | None = None
    is_active: bool | None = None


class AgentPublic(AgentBase):
    id: uuid.UUID
    created_at: datetime | None = None


class AgentsPublic(SQLModel):
    data: list[AgentPublic]
    count: int
