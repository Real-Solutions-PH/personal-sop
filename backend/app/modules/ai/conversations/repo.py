import uuid
from datetime import datetime, timezone

from sqlmodel import Session, col, func, select

from app.modules.ai.conversations.models import Conversation, Message


def get_by_id(
    *, session: Session, conversation_id: uuid.UUID, tenant_id: uuid.UUID
) -> Conversation | None:
    """Tenant filter lives in the WHERE clause: rows outside ``tenant_id``
    are invisible (natural 404, no existence leak)."""
    query = (
        select(Conversation)
        .where(Conversation.id == conversation_id)
        .where(Conversation.tenant_id == tenant_id)
    )
    return session.exec(query).first()


def get_multi_by_user(
    *,
    session: Session,
    user_id: uuid.UUID,
    tenant_id: uuid.UUID,
    skip: int = 0,
    limit: int = 50,
) -> tuple[list[Conversation], int]:
    count = session.exec(
        select(func.count())
        .select_from(Conversation)
        .where(Conversation.user_id == user_id)
        .where(Conversation.tenant_id == tenant_id)
    ).one()
    conversations = session.exec(
        select(Conversation)
        .where(Conversation.user_id == user_id)
        .where(Conversation.tenant_id == tenant_id)
        .order_by(col(Conversation.updated_at).desc())
        .offset(skip)
        .limit(limit)
    ).all()
    return list(conversations), count


def create(*, session: Session, conversation: Conversation) -> Conversation:
    session.add(conversation)
    session.commit()
    session.refresh(conversation)
    return conversation


def delete(*, session: Session, conversation: Conversation) -> None:
    session.delete(conversation)
    session.commit()


def update_timestamp(*, session: Session, conversation: Conversation) -> None:
    conversation.updated_at = datetime.now(timezone.utc)
    session.add(conversation)
    session.commit()


def create_message(*, session: Session, message: Message) -> Message:
    session.add(message)
    session.commit()
    session.refresh(message)
    return message


def get_messages(*, session: Session, conversation_id: uuid.UUID) -> list[Message]:
    return list(
        session.exec(
            select(Message)
            .where(Message.conversation_id == conversation_id)
            .order_by(col(Message.created_at).asc())
        ).all()
    )
