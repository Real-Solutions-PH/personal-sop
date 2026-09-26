import uuid
from datetime import datetime
from typing import Any

from sqlmodel import Field, SQLModel


class ToolBase(SQLModel):
    name: str = Field(max_length=64)
    description: str | None = Field(default=None, max_length=255)
    tool_type: str = Field(max_length=32)
    config: dict[str, Any] = {}
    is_active: bool = True


class ToolCreate(ToolBase):
    pass


class ToolUpdate(SQLModel):
    name: str | None = Field(default=None, max_length=64)
    description: str | None = Field(default=None, max_length=255)
    config: dict[str, Any] | None = None
    is_active: bool | None = None


class ToolPublic(ToolBase):
    id: uuid.UUID
    created_at: datetime | None = None


class ToolsPublic(SQLModel):
    data: list[ToolPublic]
    count: int


class AgentToolAssign(SQLModel):
    tool_id: uuid.UUID
