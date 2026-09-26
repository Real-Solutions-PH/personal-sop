import uuid

from fastapi import HTTPException
from sqlmodel import Session

from app.modules.ai.tools import repo as tool_repo
from app.modules.ai.tools.models import Tool
from app.modules.ai.tools.schema import ToolCreate, ToolUpdate
from app.modules.audit import services as audit

# ``config`` excluded: a tool's config can hold provider API keys.
_TOOL_AUDIT_FIELDS = ("id", "name", "tool_type", "is_active")


def list_tools(
    *, session: Session, skip: int = 0, limit: int = 100
) -> tuple[list[Tool], int]:
    return tool_repo.get_multi(session=session, skip=skip, limit=limit)


def get_tool(*, session: Session, tool_id: uuid.UUID) -> Tool:
    tool = tool_repo.get_by_id(session=session, tool_id=tool_id)
    if not tool:
        raise HTTPException(status_code=404, detail="Tool not found")
    return tool


def create_tool(
    *, session: Session, tool_in: ToolCreate, actor_id: uuid.UUID | None = None
) -> Tool:
    existing = tool_repo.get_by_name(session=session, name=tool_in.name)
    if existing:
        raise HTTPException(
            status_code=409, detail="Tool with this name already exists"
        )
    db_tool = Tool.model_validate(tool_in)
    db_tool = tool_repo.create(session=session, tool=db_tool)
    audit.record(
        session=session,
        actor_id=actor_id,
        action="tool.create",
        target_type="tool",
        target_id=db_tool.id,
        after=audit.snapshot(db_tool, _TOOL_AUDIT_FIELDS),
    )
    return db_tool


def update_tool(
    *,
    session: Session,
    tool_id: uuid.UUID,
    tool_in: ToolUpdate,
    actor_id: uuid.UUID | None = None,
) -> Tool:
    tool = tool_repo.get_by_id(session=session, tool_id=tool_id)
    if not tool:
        raise HTTPException(status_code=404, detail="Tool not found")
    before = audit.snapshot(tool, _TOOL_AUDIT_FIELDS)
    update_data = tool_in.model_dump(exclude_unset=True)
    updated = tool_repo.update(session=session, tool=tool, update_data=update_data)
    audit.record(
        session=session,
        actor_id=actor_id,
        action="tool.update",
        target_type="tool",
        target_id=tool_id,
        before=before,
        after=audit.snapshot(updated, _TOOL_AUDIT_FIELDS),
    )
    return updated


def delete_tool(
    *, session: Session, tool_id: uuid.UUID, actor_id: uuid.UUID | None = None
) -> None:
    tool = tool_repo.get_by_id(session=session, tool_id=tool_id)
    if not tool:
        raise HTTPException(status_code=404, detail="Tool not found")
    before = audit.snapshot(tool, _TOOL_AUDIT_FIELDS)
    tool_repo.delete(session=session, tool=tool)
    audit.record(
        session=session,
        actor_id=actor_id,
        action="tool.delete",
        target_type="tool",
        target_id=tool_id,
        before=before,
    )


def assign_tool_to_agent(
    *,
    session: Session,
    agent_id: uuid.UUID,
    tool_id: uuid.UUID,
    actor_id: uuid.UUID | None = None,
) -> None:
    existing = tool_repo.get_agent_tool(
        session=session, agent_id=agent_id, tool_id=tool_id
    )
    if existing:
        raise HTTPException(status_code=409, detail="Tool already assigned to agent")
    tool_repo.assign_tool_to_agent(session=session, agent_id=agent_id, tool_id=tool_id)
    audit.record(
        session=session,
        actor_id=actor_id,
        action="tool.assign_to_agent",
        target_type="tool",
        target_id=tool_id,
        after={"agent_id": str(agent_id), "tool_id": str(tool_id)},
    )


def remove_tool_from_agent(
    *,
    session: Session,
    agent_id: uuid.UUID,
    tool_id: uuid.UUID,
    actor_id: uuid.UUID | None = None,
) -> None:
    # Only audit an assignment that actually existed — recording a removal
    # that never happened would corrupt the trail's accuracy.
    existing = tool_repo.get_agent_tool(
        session=session, agent_id=agent_id, tool_id=tool_id
    )
    tool_repo.remove_tool_from_agent(
        session=session, agent_id=agent_id, tool_id=tool_id
    )
    if existing is None:
        return
    audit.record(
        session=session,
        actor_id=actor_id,
        action="tool.remove_from_agent",
        target_type="tool",
        target_id=tool_id,
        before={"agent_id": str(agent_id), "tool_id": str(tool_id)},
    )


def get_tools_for_agent(*, session: Session, agent_id: uuid.UUID) -> list[Tool]:
    return tool_repo.get_tools_for_agent(session=session, agent_id=agent_id)
