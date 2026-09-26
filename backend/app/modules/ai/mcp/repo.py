import uuid
from typing import Any

from sqlmodel import Session, col, func, select

from app.modules.ai.mcp.models import MCPServer


def get_by_id(*, session: Session, mcp_id: uuid.UUID) -> MCPServer | None:
    return session.get(MCPServer, mcp_id)


def get_by_name(*, session: Session, name: str) -> MCPServer | None:
    return session.exec(select(MCPServer).where(MCPServer.name == name)).first()


def get_multi(
    *, session: Session, skip: int = 0, limit: int = 100
) -> tuple[list[MCPServer], int]:
    count = session.exec(select(func.count()).select_from(MCPServer)).one()
    servers = session.exec(
        select(MCPServer).order_by(col(MCPServer.name)).offset(skip).limit(limit)
    ).all()
    return list(servers), count


def create(*, session: Session, mcp_server: MCPServer) -> MCPServer:
    session.add(mcp_server)
    session.commit()
    session.refresh(mcp_server)
    return mcp_server


def update(
    *, session: Session, mcp_server: MCPServer, update_data: dict[str, Any]
) -> MCPServer:
    mcp_server.sqlmodel_update(update_data)
    session.add(mcp_server)
    session.commit()
    session.refresh(mcp_server)
    return mcp_server


def delete(*, session: Session, mcp_server: MCPServer) -> None:
    session.delete(mcp_server)
    session.commit()
