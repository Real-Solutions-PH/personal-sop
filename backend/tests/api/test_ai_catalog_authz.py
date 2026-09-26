"""AI catalog + copilotkit authz (security review).

The agent/tool/mcpserver catalog is a GLOBAL platform surface (ADR-0006):
mutations are superuser-only, and MCP server routes (whose free-form
``config`` can hold URLs/credentials) are superuser-only even for reads.
The copilotkit mount requires a valid bearer token.
"""

from collections.abc import Generator

import pytest
from fastapi import FastAPI, status
from fastapi.testclient import TestClient

from app.core.config import settings
from app.modules.ai.agents.main import router as agents_router
from app.modules.ai.copilotkit import COPILOTKIT_PATH, install_copilotkit_auth
from app.modules.ai.mcp.main import router as mcp_router
from app.modules.ai.tools.main import router as tools_router
from app.shared.errors import register_exception_handlers


@pytest.fixture(scope="module")
def aux_client() -> Generator[TestClient, None, None]:
    aux_app = FastAPI()
    register_exception_handlers(aux_app)
    install_copilotkit_auth(aux_app)
    aux_app.include_router(agents_router, prefix=settings.API_V1_STR)
    aux_app.include_router(tools_router, prefix=settings.API_V1_STR)
    aux_app.include_router(mcp_router, prefix=settings.API_V1_STR)

    @aux_app.get(COPILOTKIT_PATH)
    def guarded() -> bool:  # pragma: no cover - trivial body
        return True

    with TestClient(aux_app) as c:
        yield c


def test_normal_user_cannot_mutate_agent_catalog(
    aux_client: TestClient, normal_user_token_headers: dict[str, str]
) -> None:
    r = aux_client.post(
        f"{settings.API_V1_STR}/agents/",
        headers=normal_user_token_headers,
        json={"name": "evil", "description": "x", "config": {}},
    )
    assert r.status_code == status.HTTP_403_FORBIDDEN


def test_normal_user_cannot_mutate_tool_catalog(
    aux_client: TestClient, normal_user_token_headers: dict[str, str]
) -> None:
    r = aux_client.post(
        f"{settings.API_V1_STR}/tools/",
        headers=normal_user_token_headers,
        json={"name": "evil", "description": "x", "config": {}},
    )
    assert r.status_code == status.HTTP_403_FORBIDDEN


def test_normal_user_cannot_read_mcp_servers(
    aux_client: TestClient, normal_user_token_headers: dict[str, str]
) -> None:
    r = aux_client.get(f"{settings.API_V1_STR}/mcp/", headers=normal_user_token_headers)
    assert r.status_code == status.HTTP_403_FORBIDDEN


def test_normal_user_can_still_list_agents(
    aux_client: TestClient, normal_user_token_headers: dict[str, str]
) -> None:
    r = aux_client.get(
        f"{settings.API_V1_STR}/agents/", headers=normal_user_token_headers
    )
    assert r.status_code == status.HTTP_200_OK


def test_copilotkit_guard_rejects_anonymous(aux_client: TestClient) -> None:
    r = aux_client.get(COPILOTKIT_PATH)
    assert r.status_code == status.HTTP_401_UNAUTHORIZED
    assert r.json()["code"] == "unauthorized"


def test_copilotkit_guard_rejects_garbage_token(aux_client: TestClient) -> None:
    r = aux_client.get(COPILOTKIT_PATH, headers={"Authorization": "Bearer not-a-jwt"})
    assert r.status_code == status.HTTP_401_UNAUTHORIZED


def test_copilotkit_guard_accepts_valid_token(
    aux_client: TestClient, normal_user_token_headers: dict[str, str]
) -> None:
    r = aux_client.get(COPILOTKIT_PATH, headers=normal_user_token_headers)
    assert r.status_code == status.HTTP_200_OK
