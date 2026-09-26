import uuid
from typing import Any

from sqlmodel import Session, col, func, select

from app.modules.ai.agents.models import Agent


def get_by_id(*, session: Session, agent_id: uuid.UUID) -> Agent | None:
    return session.get(Agent, agent_id)


def get_by_name(*, session: Session, name: str) -> Agent | None:
    return session.exec(select(Agent).where(Agent.name == name)).first()


def get_multi(
    *, session: Session, skip: int = 0, limit: int = 100
) -> tuple[list[Agent], int]:
    count = session.exec(select(func.count()).select_from(Agent)).one()
    agents = session.exec(
        select(Agent).order_by(col(Agent.name)).offset(skip).limit(limit)
    ).all()
    return list(agents), count


def create(*, session: Session, agent: Agent) -> Agent:
    session.add(agent)
    session.commit()
    session.refresh(agent)
    return agent


def update(*, session: Session, agent: Agent, update_data: dict[str, Any]) -> Agent:
    agent.sqlmodel_update(update_data)
    session.add(agent)
    session.commit()
    session.refresh(agent)
    return agent


def delete(*, session: Session, agent: Agent) -> None:
    session.delete(agent)
    session.commit()
