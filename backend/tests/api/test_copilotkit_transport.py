"""AG-UI chat transport smoke tests (ADR-0007).

Transport-level only — no LLM call is ever made (no provider creds in CI):
the info route proves the handshake shape and agent catalog, the run routes
are exercised just far enough to prove they exist and sit behind auth
(request validation fires before any graph/LLM execution).
"""

from collections.abc import Generator

import pytest
from fastapi import FastAPI, status
from fastapi.testclient import TestClient

from app.core.config import settings
from app.modules.ai.copilotkit import COPILOTKIT_PATH, setup_copilotkit
from app.shared.errors import register_exception_handlers

EXPECTED_AGENTS = {"fast", "react", "plan_and_execute"}


@pytest.fixture(scope="module")
def agui_client() -> Generator[TestClient, None, None]:
    """App with the real AG-UI mount, built against a dummy LLM key.

    ``ChatOpenAI`` refuses to construct without a key; a dummy is enough
    because these tests never run a graph.
    """
    original_key = settings.NEBIUS_API_KEY
    settings.NEBIUS_API_KEY = "test-key-never-used"
    try:
        aux_app = FastAPI()
        register_exception_handlers(aux_app)
        setup_copilotkit(aux_app)
        with TestClient(aux_app) as c:
            yield c
    finally:
        settings.NEBIUS_API_KEY = original_key


def test_info_rejects_anonymous(agui_client: TestClient) -> None:
    r = agui_client.get(COPILOTKIT_PATH)
    assert r.status_code == status.HTTP_401_UNAUTHORIZED
    assert r.json()["code"] == "unauthorized"
    assert r.headers["WWW-Authenticate"] == "Bearer"


def test_info_lists_agents_with_valid_token(
    agui_client: TestClient, normal_user_token_headers: dict[str, str]
) -> None:
    r = agui_client.get(COPILOTKIT_PATH, headers=normal_user_token_headers)
    assert r.status_code == status.HTTP_200_OK
    body = r.json()
    assert body["protocol"] == "ag-ui"
    agents = {a["name"]: a for a in body["agents"]}
    assert set(agents) == EXPECTED_AGENTS
    for agent in agents.values():
        assert agent["description"]


@pytest.mark.parametrize("name", sorted(EXPECTED_AGENTS))
def test_run_route_rejects_anonymous(agui_client: TestClient, name: str) -> None:
    r = agui_client.post(f"{COPILOTKIT_PATH}/agents/{name}", json={})
    assert r.status_code == status.HTTP_401_UNAUTHORIZED


@pytest.mark.parametrize("name", sorted(EXPECTED_AGENTS))
def test_run_route_exists_and_validates_agui_input(
    agui_client: TestClient, normal_user_token_headers: dict[str, str], name: str
) -> None:
    # An empty body is not a RunAgentInput: 422 proves the route is mounted,
    # auth passed, and AG-UI input validation runs — without invoking the LLM.
    r = agui_client.post(
        f"{COPILOTKIT_PATH}/agents/{name}",
        headers=normal_user_token_headers,
        json={},
    )
    assert r.status_code == status.HTTP_422_UNPROCESSABLE_ENTITY


def test_unknown_agent_is_404(
    agui_client: TestClient, normal_user_token_headers: dict[str, str]
) -> None:
    r = agui_client.post(
        f"{COPILOTKIT_PATH}/agents/nope",
        headers=normal_user_token_headers,
        json={},
    )
    assert r.status_code == status.HTTP_404_NOT_FOUND
