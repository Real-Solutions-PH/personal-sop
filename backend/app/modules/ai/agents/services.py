import uuid

from fastapi import HTTPException
from sqlmodel import Session

from app.modules.ai.agents import repo as agent_repo
from app.modules.ai.agents.models import Agent
from app.modules.ai.agents.schema import AgentCreate, AgentUpdate


def list_agents(
    *, session: Session, skip: int = 0, limit: int = 100
) -> tuple[list[Agent], int]:
    return agent_repo.get_multi(session=session, skip=skip, limit=limit)


def get_agent(*, session: Session, agent_id: uuid.UUID) -> Agent:
    agent = agent_repo.get_by_id(session=session, agent_id=agent_id)
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")
    return agent


def create_agent(*, session: Session, agent_in: AgentCreate) -> Agent:
    existing = agent_repo.get_by_name(session=session, name=agent_in.name)
    if existing:
        raise HTTPException(
            status_code=409, detail="Agent with this name already exists"
        )
    db_agent = Agent.model_validate(agent_in)
    return agent_repo.create(session=session, agent=db_agent)


def update_agent(
    *, session: Session, agent_id: uuid.UUID, agent_in: AgentUpdate
) -> Agent:
    agent = agent_repo.get_by_id(session=session, agent_id=agent_id)
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")
    update_data = agent_in.model_dump(exclude_unset=True)
    return agent_repo.update(session=session, agent=agent, update_data=update_data)


def delete_agent(*, session: Session, agent_id: uuid.UUID) -> None:
    agent = agent_repo.get_by_id(session=session, agent_id=agent_id)
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")
    agent_repo.delete(session=session, agent=agent)
