import uuid

from fastapi import HTTPException
from sqlmodel import Session

from app.modules.ai.mcp import repo as mcp_repo
from app.modules.ai.mcp.models import MCPServer
from app.modules.ai.mcp.schema import MCPServerCreate, MCPServerUpdate
from app.modules.audit import services as audit

# ``config`` is deliberately excluded: it can hold credentials and is
# write-only — it must never reach an audit snapshot.
_MCP_AUDIT_FIELDS = ("id", "name", "url", "is_active")


def list_mcp_servers(
    *, session: Session, skip: int = 0, limit: int = 100
) -> tuple[list[MCPServer], int]:
    return mcp_repo.get_multi(session=session, skip=skip, limit=limit)


def get_mcp_server(*, session: Session, mcp_id: uuid.UUID) -> MCPServer:
    server = mcp_repo.get_by_id(session=session, mcp_id=mcp_id)
    if not server:
        raise HTTPException(status_code=404, detail="MCP server not found")
    return server


def create_mcp_server(
    *, session: Session, mcp_in: MCPServerCreate, actor_id: uuid.UUID | None = None
) -> MCPServer:
    existing = mcp_repo.get_by_name(session=session, name=mcp_in.name)
    if existing:
        raise HTTPException(
            status_code=409, detail="MCP server with this name already exists"
        )
    # config is a typed write-only model; flatten it to a plain dict for the
    # JSONB column (extra keys included).
    db_server = MCPServer.model_validate(
        mcp_in, update={"config": mcp_in.config.model_dump(exclude_unset=True)}
    )
    db_server = mcp_repo.create(session=session, mcp_server=db_server)
    audit.record(
        session=session,
        actor_id=actor_id,
        action="mcp_server.create",
        target_type="mcp_server",
        target_id=db_server.id,
        after=audit.snapshot(db_server, _MCP_AUDIT_FIELDS),
    )
    return db_server


def update_mcp_server(
    *,
    session: Session,
    mcp_id: uuid.UUID,
    mcp_in: MCPServerUpdate,
    actor_id: uuid.UUID | None = None,
) -> MCPServer:
    server = mcp_repo.get_by_id(session=session, mcp_id=mcp_id)
    if not server:
        raise HTTPException(status_code=404, detail="MCP server not found")
    before = audit.snapshot(server, _MCP_AUDIT_FIELDS)
    update_data = mcp_in.model_dump(exclude_unset=True)
    updated = mcp_repo.update(
        session=session, mcp_server=server, update_data=update_data
    )
    audit.record(
        session=session,
        actor_id=actor_id,
        action="mcp_server.update",
        target_type="mcp_server",
        target_id=mcp_id,
        before=before,
        after=audit.snapshot(updated, _MCP_AUDIT_FIELDS),
    )
    return updated


def delete_mcp_server(
    *, session: Session, mcp_id: uuid.UUID, actor_id: uuid.UUID | None = None
) -> None:
    server = mcp_repo.get_by_id(session=session, mcp_id=mcp_id)
    if not server:
        raise HTTPException(status_code=404, detail="MCP server not found")
    before = audit.snapshot(server, _MCP_AUDIT_FIELDS)
    mcp_repo.delete(session=session, mcp_server=server)
    audit.record(
        session=session,
        actor_id=actor_id,
        action="mcp_server.delete",
        target_type="mcp_server",
        target_id=mcp_id,
        before=before,
    )
