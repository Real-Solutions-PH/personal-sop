import uuid
from datetime import datetime
from typing import Any

from sqlmodel import Field, SQLModel


class MessagePublic(SQLModel):
    id: uuid.UUID
    conversation_id: uuid.UUID
    role: str
    content: str
    metadata_: dict[str, Any] | None = None
    created_at: datetime | None = None


class ConversationBase(SQLModel):
    title: str = Field(default="New conversation", max_length=255)
    agent_id: uuid.UUID | None = None


class ConversationCreate(ConversationBase):
    pass


class ConversationUpdate(SQLModel):
    title: str | None = Field(default=None, max_length=255)
    agent_id: uuid.UUID | None = None


class ConversationPublic(ConversationBase):
    id: uuid.UUID
    user_id: uuid.UUID
    tenant_id: uuid.UUID | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None


class ConversationsPublic(SQLModel):
    data: list[ConversationPublic]
    count: int


class ConversationWithMessages(ConversationPublic):
    messages: list[MessagePublic] = []
