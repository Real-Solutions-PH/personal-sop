import uuid

from fastapi import HTTPException
from sqlmodel import Session

from app.modules.ai.agents import repo as agent_repo
from app.modules.ai.conversations import repo as conv_repo
from app.modules.ai.conversations.models import Conversation
from app.modules.ai.conversations.schema import ConversationCreate
from app.modules.iam.users.models import User


def list_conversations(
    *, session: Session, current_user: User, skip: int = 0, limit: int = 50
) -> tuple[list[Conversation], int]:
    return conv_repo.get_multi_by_user(
        session=session,
        user_id=current_user.id,
        tenant_id=current_user.tenant_id,
        skip=skip,
        limit=limit,
    )


def get_conversation_with_messages(
    *, session: Session, current_user: User, conversation_id: uuid.UUID
) -> Conversation:
    conversation = conv_repo.get_by_id(
        session=session,
        conversation_id=conversation_id,
        tenant_id=current_user.tenant_id,
    )
    if not conversation or conversation.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return conversation


def create_conversation(
    *, session: Session, current_user: User, conv_in: ConversationCreate
) -> Conversation:
    if conv_in.agent_id is not None:
        agent = agent_repo.get_by_id(session=session, agent_id=conv_in.agent_id)
        if agent is None or not agent.is_active:
            raise HTTPException(status_code=404, detail="Agent not found")
    db_conv = Conversation(
        user_id=current_user.id,
        tenant_id=current_user.tenant_id,
        title=conv_in.title,
        agent_id=conv_in.agent_id,
    )
    return conv_repo.create(session=session, conversation=db_conv)


def delete_conversation(
    *, session: Session, current_user: User, conversation_id: uuid.UUID
) -> None:
    conversation = conv_repo.get_by_id(
        session=session,
        conversation_id=conversation_id,
        tenant_id=current_user.tenant_id,
    )
    if not conversation or conversation.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Conversation not found")
    conv_repo.delete(session=session, conversation=conversation)
