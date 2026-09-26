"""AI-catalog authorization expressed as RBAC permission codes.

The agent/tool/mcp catalog was previously gated purely on the ``is_superuser``
flag. It is now gated on permission codes (`agents:write`, `tools:write`,
`mcp:read`, `mcp:write`) so the seeded ``superadmin`` role — whose grant is "*"
— reaches these surfaces too, not only accounts with the raw flag. The
superuser flag still bypasses. Ordinary reads of the agent/tool catalog stay
open to any authenticated user (a global platform listing).

The AI routers are only mounted on the main app when AI_ENABLED is true, so
(like test_ai_catalog_authz) these tests mount them on a self-contained app.
"""

from collections.abc import Generator

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlmodel import Session

from app.core.config import settings
from app.modules.ai.agents.main import router as agents_router
from app.modules.ai.mcp.main import router as mcp_router
from app.modules.ai.tools.main import router as tools_router
from app.modules.iam.rbac import repo as rbac_repo
from app.modules.iam.roles import repo as role_repo
from app.shared.errors import register_exception_handlers
from tests.utils.user import create_auth_user, user_authentication_headers


@pytest.fixture(scope="module")
def aux_client() -> Generator[TestClient, None, None]:
    aux_app = FastAPI()
    register_exception_handlers(aux_app)
    aux_app.include_router(agents_router, prefix=settings.API_V1_STR)
    aux_app.include_router(tools_router, prefix=settings.API_V1_STR)
    aux_app.include_router(mcp_router, prefix=settings.API_V1_STR)
    with TestClient(aux_app) as c:
        yield c


def _headers_for_role(db: Session, role_name: str) -> dict[str, str]:
    user, password = create_auth_user(db)
    role = role_repo.get_by_name(session=db, name=role_name)
    assert role is not None, f"role {role_name!r} must be seeded"
    rbac_repo.assign_role_to_user(session=db, user_id=user.id, role_id=role.id)
    return user_authentication_headers(email=user.email, password=password)


def _url(path: str) -> str:
    return f"{settings.API_V1_STR}{path}"


def test_superadmin_role_can_mutate_agent_catalog(
    aux_client: TestClient, db: Session
) -> None:
    # superadmin role holds "*", so it now clears agents:write (a valid body
    # would create) — previously a non-flag account was 403. Use a valid body
    # so the gate, not body validation, decides the status.
    headers = _headers_for_role(db, "superadmin")
    r = aux_client.post(
        _url("/agents/"),
        headers=headers,
        json={"name": "rbac-superadmin-agent", "description": "x", "config": {}},
    )
    assert r.status_code != 403


def test_superadmin_role_can_mutate_tool_catalog(
    aux_client: TestClient, db: Session
) -> None:
    headers = _headers_for_role(db, "superadmin")
    r = aux_client.post(
        _url("/tools/"),
        headers=headers,
        json={"name": "rbac-superadmin-tool", "description": "x", "config": {}},
    )
    assert r.status_code != 403


def test_superadmin_role_can_read_mcp_servers(
    aux_client: TestClient, db: Session
) -> None:
    headers = _headers_for_role(db, "superadmin")
    r = aux_client.get(_url("/mcp/"), headers=headers)
    assert r.status_code == 200


def test_admin_role_cannot_mutate_agent_catalog(
    aux_client: TestClient, db: Session
) -> None:
    # admin does NOT hold agents:write — the catalog stays a platform surface.
    headers = _headers_for_role(db, "admin")
    r = aux_client.post(
        _url("/agents/"),
        headers=headers,
        json={"name": "x", "description": "x", "config": {}},
    )
    assert r.status_code == 403


def test_normal_user_cannot_mutate_agent_catalog(
    aux_client: TestClient, normal_user_token_headers: dict[str, str]
) -> None:
    r = aux_client.post(
        _url("/agents/"),
        headers=normal_user_token_headers,
        json={"name": "x", "description": "x", "config": {}},
    )
    assert r.status_code == 403


def test_normal_user_cannot_read_mcp_servers(
    aux_client: TestClient, normal_user_token_headers: dict[str, str]
) -> None:
    r = aux_client.get(_url("/mcp/"), headers=normal_user_token_headers)
    assert r.status_code == 403


def test_normal_user_can_still_list_agents(
    aux_client: TestClient, normal_user_token_headers: dict[str, str]
) -> None:
    # Reads of the agent catalog remain open to any authenticated user.
    r = aux_client.get(_url("/agents/"), headers=normal_user_token_headers)
    assert r.status_code == 200
