import uuid
from typing import Any

from fastapi import APIRouter, Depends

from app.modules.ai.conversations import services as conv_service
from app.modules.ai.conversations.schema import (
    ConversationCreate,
    ConversationPublic,
    ConversationsPublic,
    ConversationWithMessages,
)
from app.modules.iam.deps import CurrentUser, require_permission
from app.shared.pagination import PaginationDep
from app.shared.rate_limit import rate_limited
from app.shared.schema import Message
from app.shared.tenant_session import TenantScopedSessionDep

router = APIRouter(prefix="/chat", tags=["ai-chat"])


@router.get(
    "/conversations",
    response_model=ConversationsPublic,
    dependencies=[Depends(require_permission("conversations:read"))],
)
def read_conversations(
    session: TenantScopedSessionDep,
    current_user: CurrentUser,
    pagination: PaginationDep,
) -> Any:
    conversations, count = conv_service.list_conversations(
        session=session,
        current_user=current_user,
        skip=pagination.skip,
        limit=pagination.limit,
    )
    return ConversationsPublic(
        data=[ConversationPublic.model_validate(c) for c in conversations],
        count=count,
    )


@router.get(
    "/conversations/{conversation_id}",
    response_model=ConversationWithMessages,
    dependencies=[Depends(require_permission("conversations:read"))],
)
def read_conversation(
    session: TenantScopedSessionDep,
    current_user: CurrentUser,
    conversation_id: uuid.UUID,
) -> Any:
    return conv_service.get_conversation_with_messages(
        session=session,
        current_user=current_user,
        conversation_id=conversation_id,
    )


@router.post(
    "/conversations",
    response_model=ConversationPublic,
    dependencies=[
        rate_limited("ai-chat"),
        Depends(require_permission("conversations:write")),
    ],
)
def create_conversation(
    *,
    session: TenantScopedSessionDep,
    current_user: CurrentUser,
    conv_in: ConversationCreate,
) -> Any:
    return conv_service.create_conversation(
        session=session, current_user=current_user, conv_in=conv_in
    )


@router.delete(
    "/conversations/{conversation_id}",
    dependencies=[
        rate_limited("ai-chat"),
        Depends(require_permission("conversations:write")),
    ],
)
def delete_conversation(
    session: TenantScopedSessionDep,
    current_user: CurrentUser,
    conversation_id: uuid.UUID,
) -> Message:
    conv_service.delete_conversation(
        session=session,
        current_user=current_user,
        conversation_id=conversation_id,
    )
    return Message(message="Conversation deleted successfully")
