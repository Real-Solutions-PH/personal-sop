import uuid
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import DateTime, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlmodel import Column, Field, Relationship, SQLModel


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Conversation(SQLModel, table=True):
    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    user_id: uuid.UUID = Field(
        foreign_key="user.id", nullable=False, ondelete="CASCADE", index=True
    )
    tenant_id: uuid.UUID = Field(
        foreign_key="tenant.id", nullable=False, ondelete="CASCADE", index=True
    )
    title: str = Field(default="New conversation", max_length=255)
    agent_id: uuid.UUID | None = Field(
        default=None, foreign_key="agent.id", ondelete="SET NULL", index=True
    )
    created_at: datetime | None = Field(  # type: ignore[call-overload]
        default_factory=_utcnow,
        sa_type=DateTime(timezone=True),
    )
    updated_at: datetime | None = Field(  # type: ignore[call-overload]
        default_factory=_utcnow,
        sa_type=DateTime(timezone=True),
    )
    messages: list["Message"] = Relationship(
        back_populates="conversation",
        cascade_delete=True,
    )


class Message(SQLModel, table=True):
    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    conversation_id: uuid.UUID = Field(
        foreign_key="conversation.id", nullable=False, ondelete="CASCADE", index=True
    )
    role: str = Field(max_length=16)
    content: str = Field(sa_column=Column(Text, nullable=False))
    metadata_: dict[str, Any] | None = Field(
        default=None, sa_column=Column("metadata", JSONB)
    )
    created_at: datetime | None = Field(  # type: ignore[call-overload]
        default_factory=_utcnow,
        sa_type=DateTime(timezone=True),
    )
    conversation: Conversation | None = Relationship(back_populates="messages")
