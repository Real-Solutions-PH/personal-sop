import uuid
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import DateTime
from sqlalchemy.dialects.postgresql import JSONB
from sqlmodel import Column, Field, SQLModel


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Tool(SQLModel, table=True):
    __tablename__ = "tool"
    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    name: str = Field(unique=True, index=True, max_length=64)
    description: str | None = Field(default=None, max_length=255)
    tool_type: str = Field(max_length=32)
    config: dict[str, Any] = Field(
        default_factory=dict,
        sa_column=Column(JSONB, nullable=False, server_default="{}"),
    )
    is_active: bool = True
    created_at: datetime | None = Field(  # type: ignore[call-overload]
        default_factory=_utcnow,
        sa_type=DateTime(timezone=True),
    )


class AgentTool(SQLModel, table=True):
    __tablename__ = "agenttool"
    agent_id: uuid.UUID = Field(
        foreign_key="agent.id", primary_key=True, ondelete="CASCADE"
    )
    tool_id: uuid.UUID = Field(
        foreign_key="tool.id", primary_key=True, ondelete="CASCADE"
    )
