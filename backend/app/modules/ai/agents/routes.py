import uuid
from typing import Any

from fastapi import APIRouter, Depends

from app.modules.ai.agents import services as agent_service
from app.modules.ai.agents.schema import (
    AgentCreate,
    AgentPublic,
    AgentsPublic,
    AgentUpdate,
)
from app.modules.iam.deps import CurrentUser, require_permission
from app.shared.deps import SessionDep
from app.shared.pagination import PaginationDep
from app.shared.schema import Message

router = APIRouter(prefix="/agents", tags=["ai-agents"])


@router.get("/", response_model=AgentsPublic)
def read_agents(
    session: SessionDep, _current_user: CurrentUser, pagination: PaginationDep
) -> Any:
    agents, count = agent_service.list_agents(
        session=session, skip=pagination.skip, limit=pagination.limit
    )
    return AgentsPublic(
        data=[AgentPublic.model_validate(a) for a in agents], count=count
    )


@router.get("/{id}", response_model=AgentPublic)
def read_agent(session: SessionDep, _current_user: CurrentUser, id: uuid.UUID) -> Any:
    return agent_service.get_agent(session=session, agent_id=id)


@router.post(
    "/",
    dependencies=[Depends(require_permission("agents:write"))],
    response_model=AgentPublic,
)
def create_agent(
    *, session: SessionDep, _current_user: CurrentUser, agent_in: AgentCreate
) -> Any:
    return agent_service.create_agent(session=session, agent_in=agent_in)


@router.put(
    "/{id}",
    dependencies=[Depends(require_permission("agents:write"))],
    response_model=AgentPublic,
)
def update_agent(
    *,
    session: SessionDep,
    _current_user: CurrentUser,
    id: uuid.UUID,
    agent_in: AgentUpdate,
) -> Any:
    return agent_service.update_agent(session=session, agent_id=id, agent_in=agent_in)


@router.delete("/{id}", dependencies=[Depends(require_permission("agents:write"))])
def delete_agent(
    session: SessionDep, _current_user: CurrentUser, id: uuid.UUID
) -> Message:
    agent_service.delete_agent(session=session, agent_id=id)
    return Message(message="Agent deleted successfully")
