import uuid
from typing import Any

from sqlmodel import Session, col, func, select

from app.modules.ai.tools.models import AgentTool, Tool


def get_by_id(*, session: Session, tool_id: uuid.UUID) -> Tool | None:
    return session.get(Tool, tool_id)


def get_by_name(*, session: Session, name: str) -> Tool | None:
    return session.exec(select(Tool).where(Tool.name == name)).first()


def get_multi(
    *, session: Session, skip: int = 0, limit: int = 100
) -> tuple[list[Tool], int]:
    count = session.exec(select(func.count()).select_from(Tool)).one()
    tools = session.exec(
        select(Tool).order_by(col(Tool.name)).offset(skip).limit(limit)
    ).all()
    return list(tools), count


def create(*, session: Session, tool: Tool) -> Tool:
    session.add(tool)
    session.commit()
    session.refresh(tool)
    return tool


def update(*, session: Session, tool: Tool, update_data: dict[str, Any]) -> Tool:
    tool.sqlmodel_update(update_data)
    session.add(tool)
    session.commit()
    session.refresh(tool)
    return tool


def delete(*, session: Session, tool: Tool) -> None:
    session.delete(tool)
    session.commit()


# --- AgentTool link helpers ---


def get_agent_tool(
    *, session: Session, agent_id: uuid.UUID, tool_id: uuid.UUID
) -> AgentTool | None:
    return session.exec(
        select(AgentTool).where(
            AgentTool.agent_id == agent_id, AgentTool.tool_id == tool_id
        )
    ).first()


def assign_tool_to_agent(
    *, session: Session, agent_id: uuid.UUID, tool_id: uuid.UUID
) -> AgentTool:
    link = AgentTool(agent_id=agent_id, tool_id=tool_id)
    session.add(link)
    session.commit()
    return link


def remove_tool_from_agent(
    *, session: Session, agent_id: uuid.UUID, tool_id: uuid.UUID
) -> None:
    link = session.exec(
        select(AgentTool).where(
            AgentTool.agent_id == agent_id, AgentTool.tool_id == tool_id
        )
    ).first()
    if link:
        session.delete(link)
        session.commit()


def get_tools_for_agent(*, session: Session, agent_id: uuid.UUID) -> list[Tool]:
    stmt = select(Tool).join(AgentTool).where(AgentTool.agent_id == agent_id)
    return list(session.exec(stmt).all())
