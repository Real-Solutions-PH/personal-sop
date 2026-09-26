import uuid
from typing import Any

from fastapi import APIRouter, Depends

from app.modules.ai.mcp import services as mcp_service
from app.modules.ai.mcp.schema import (
    MCPServerCreate,
    MCPServerPublic,
    MCPServersPublic,
    MCPServerUpdate,
)
from app.modules.iam.deps import CurrentUser, require_permission
from app.shared.deps import SessionDep
from app.shared.pagination import PaginationDep
from app.shared.schema import Message

# Platform surface, not tenant data: MCPServer.config is a free-form dict that
# can hold URLs/credentials. Reads require mcp:read, mutations mcp:write — both
# held by the superadmin role's "*" grant; the superuser flag still bypasses.
router = APIRouter(
    prefix="/mcp",
    tags=["ai-mcp"],
    dependencies=[Depends(require_permission("mcp:read"))],
)


@router.get("/", response_model=MCPServersPublic)
def read_mcp_servers(
    session: SessionDep, _current_user: CurrentUser, pagination: PaginationDep
) -> Any:
    servers, count = mcp_service.list_mcp_servers(
        session=session, skip=pagination.skip, limit=pagination.limit
    )
    return MCPServersPublic(
        data=[MCPServerPublic.model_validate(s) for s in servers], count=count
    )


@router.get("/{id}", response_model=MCPServerPublic)
def read_mcp_server(
    session: SessionDep, _current_user: CurrentUser, id: uuid.UUID
) -> Any:
    return mcp_service.get_mcp_server(session=session, mcp_id=id)


@router.post(
    "/",
    response_model=MCPServerPublic,
    dependencies=[Depends(require_permission("mcp:write"))],
)
def create_mcp_server(
    *, session: SessionDep, _current_user: CurrentUser, mcp_in: MCPServerCreate
) -> Any:
    return mcp_service.create_mcp_server(session=session, mcp_in=mcp_in)


@router.put(
    "/{id}",
    response_model=MCPServerPublic,
    dependencies=[Depends(require_permission("mcp:write"))],
)
def update_mcp_server(
    *,
    session: SessionDep,
    _current_user: CurrentUser,
    id: uuid.UUID,
    mcp_in: MCPServerUpdate,
) -> Any:
    return mcp_service.update_mcp_server(session=session, mcp_id=id, mcp_in=mcp_in)


@router.delete("/{id}", dependencies=[Depends(require_permission("mcp:write"))])
def delete_mcp_server(
    session: SessionDep, _current_user: CurrentUser, id: uuid.UUID
) -> Message:
    mcp_service.delete_mcp_server(session=session, mcp_id=id)
    return Message(message="MCP server deleted successfully")
