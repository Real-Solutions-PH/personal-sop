"""Superuser CRUD flows over the AI catalog (agents / tools / mcp).

Complements test_ai_catalog_authz.py (which proves the permission wall):
these tests drive the happy paths and error branches of the routes ->
services -> repos stack. Mounted on an auxiliary app because the main app
only includes the AI routers when AI_ENABLED is set.
"""

import uuid
from collections.abc import Generator

import pytest
from fastapi import FastAPI, status
from fastapi.testclient import TestClient

from app.core.config import settings
from app.modules.ai.agents.main import router as agents_router
from app.modules.ai.mcp.main import router as mcp_router
from app.modules.ai.tools.main import router as tools_router
from app.shared.errors import register_exception_handlers
from tests.utils.utils import random_lower_string

AGENTS = f"{settings.API_V1_STR}/agents"
TOOLS = f"{settings.API_V1_STR}/tools"
MCP = f"{settings.API_V1_STR}/mcp"


@pytest.fixture(scope="module")
def aux_client() -> Generator[TestClient, None, None]:
    aux_app = FastAPI()
    register_exception_handlers(aux_app)
    aux_app.include_router(agents_router, prefix=settings.API_V1_STR)
    aux_app.include_router(tools_router, prefix=settings.API_V1_STR)
    aux_app.include_router(mcp_router, prefix=settings.API_V1_STR)
    with TestClient(aux_app) as c:
        yield c


def _create_agent(
    client: TestClient, headers: dict[str, str], name: str | None = None
) -> dict[str, object]:
    r = client.post(
        f"{AGENTS}/",
        headers=headers,
        json={"name": name or f"agent-{random_lower_string()[:12]}"},
    )
    assert r.status_code == status.HTTP_200_OK
    data: dict[str, object] = r.json()
    return data


def _create_tool(
    client: TestClient, headers: dict[str, str], name: str | None = None
) -> dict[str, object]:
    r = client.post(
        f"{TOOLS}/",
        headers=headers,
        json={
            "name": name or f"tool-{random_lower_string()[:12]}",
            "tool_type": "brave_search",
        },
    )
    assert r.status_code == status.HTTP_200_OK
    data: dict[str, object] = r.json()
    return data


# --- agents ---


def test_agent_crud_lifecycle(
    aux_client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    created = _create_agent(aux_client, superuser_token_headers)
    agent_id = created["id"]

    r = aux_client.get(f"{AGENTS}/{agent_id}", headers=superuser_token_headers)
    assert r.status_code == status.HTTP_200_OK
    assert r.json()["name"] == created["name"]

    r = aux_client.get(f"{AGENTS}/", headers=superuser_token_headers)
    assert r.status_code == status.HTTP_200_OK
    assert r.json()["count"] >= 1
    assert any(a["id"] == agent_id for a in r.json()["data"])

    r = aux_client.put(
        f"{AGENTS}/{agent_id}",
        headers=superuser_token_headers,
        json={"description": "updated", "is_active": False},
    )
    assert r.status_code == status.HTTP_200_OK
    assert r.json()["description"] == "updated"
    assert r.json()["is_active"] is False

    r = aux_client.delete(f"{AGENTS}/{agent_id}", headers=superuser_token_headers)
    assert r.status_code == status.HTTP_200_OK

    r = aux_client.get(f"{AGENTS}/{agent_id}", headers=superuser_token_headers)
    assert r.status_code == status.HTTP_404_NOT_FOUND


def test_agent_duplicate_name_is_409(
    aux_client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    created = _create_agent(aux_client, superuser_token_headers)
    r = aux_client.post(
        f"{AGENTS}/",
        headers=superuser_token_headers,
        json={"name": created["name"]},
    )
    assert r.status_code == status.HTTP_409_CONFLICT


def test_agent_update_and_delete_missing_is_404(
    aux_client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    missing = uuid.uuid4()
    r = aux_client.put(
        f"{AGENTS}/{missing}", headers=superuser_token_headers, json={"name": "x"}
    )
    assert r.status_code == status.HTTP_404_NOT_FOUND
    r = aux_client.delete(f"{AGENTS}/{missing}", headers=superuser_token_headers)
    assert r.status_code == status.HTTP_404_NOT_FOUND


# --- tools ---


def test_tool_crud_lifecycle(
    aux_client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    created = _create_tool(aux_client, superuser_token_headers)
    tool_id = created["id"]

    r = aux_client.get(f"{TOOLS}/{tool_id}", headers=superuser_token_headers)
    assert r.status_code == status.HTTP_200_OK

    r = aux_client.get(f"{TOOLS}/", headers=superuser_token_headers)
    assert r.status_code == status.HTTP_200_OK
    assert any(t["id"] == tool_id for t in r.json()["data"])

    r = aux_client.put(
        f"{TOOLS}/{tool_id}",
        headers=superuser_token_headers,
        json={"description": "updated"},
    )
    assert r.status_code == status.HTTP_200_OK
    assert r.json()["description"] == "updated"

    r = aux_client.delete(f"{TOOLS}/{tool_id}", headers=superuser_token_headers)
    assert r.status_code == status.HTTP_200_OK
    r = aux_client.get(f"{TOOLS}/{tool_id}", headers=superuser_token_headers)
    assert r.status_code == status.HTTP_404_NOT_FOUND


def test_tool_duplicate_name_is_409(
    aux_client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    created = _create_tool(aux_client, superuser_token_headers)
    r = aux_client.post(
        f"{TOOLS}/",
        headers=superuser_token_headers,
        json={"name": created["name"], "tool_type": "brave_search"},
    )
    assert r.status_code == status.HTTP_409_CONFLICT


def test_tool_update_and_delete_missing_is_404(
    aux_client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    missing = uuid.uuid4()
    r = aux_client.put(
        f"{TOOLS}/{missing}", headers=superuser_token_headers, json={"name": "x"}
    )
    assert r.status_code == status.HTTP_404_NOT_FOUND
    r = aux_client.delete(f"{TOOLS}/{missing}", headers=superuser_token_headers)
    assert r.status_code == status.HTTP_404_NOT_FOUND


def test_tool_assign_unassign_flow(
    aux_client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    agent = _create_agent(aux_client, superuser_token_headers)
    tool = _create_tool(aux_client, superuser_token_headers)

    r = aux_client.post(
        f"{TOOLS}/agent/{agent['id']}",
        headers=superuser_token_headers,
        json={"tool_id": tool["id"]},
    )
    assert r.status_code == status.HTTP_200_OK

    # duplicate assignment is rejected
    r = aux_client.post(
        f"{TOOLS}/agent/{agent['id']}",
        headers=superuser_token_headers,
        json={"tool_id": tool["id"]},
    )
    assert r.status_code == status.HTTP_409_CONFLICT

    r = aux_client.get(f"{TOOLS}/agent/{agent['id']}", headers=superuser_token_headers)
    assert r.status_code == status.HTTP_200_OK
    assert r.json()["count"] == 1
    assert r.json()["data"][0]["id"] == tool["id"]

    r = aux_client.delete(
        f"{TOOLS}/agent/{agent['id']}/{tool['id']}",
        headers=superuser_token_headers,
    )
    assert r.status_code == status.HTTP_200_OK

    r = aux_client.get(f"{TOOLS}/agent/{agent['id']}", headers=superuser_token_headers)
    assert r.json()["count"] == 0

    # unassigning a link that no longer exists is a silent no-op
    r = aux_client.delete(
        f"{TOOLS}/agent/{agent['id']}/{tool['id']}",
        headers=superuser_token_headers,
    )
    assert r.status_code == status.HTTP_200_OK


# --- mcp servers ---


def test_mcp_crud_lifecycle(
    aux_client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    name = f"mcp-{random_lower_string()[:12]}"
    r = aux_client.post(
        f"{MCP}/",
        headers=superuser_token_headers,
        json={"name": name, "url": "https://mcp.example.com/sse", "config": {}},
    )
    assert r.status_code == status.HTTP_200_OK
    mcp_id = r.json()["id"]

    # duplicate name rejected
    r = aux_client.post(
        f"{MCP}/",
        headers=superuser_token_headers,
        json={"name": name, "url": "https://mcp.example.com/other"},
    )
    assert r.status_code == status.HTTP_409_CONFLICT

    r = aux_client.get(f"{MCP}/{mcp_id}", headers=superuser_token_headers)
    assert r.status_code == status.HTTP_200_OK
    assert r.json()["name"] == name

    r = aux_client.get(f"{MCP}/", headers=superuser_token_headers)
    assert r.status_code == status.HTTP_200_OK
    assert any(s["id"] == mcp_id for s in r.json()["data"])

    r = aux_client.put(
        f"{MCP}/{mcp_id}",
        headers=superuser_token_headers,
        json={"url": "https://mcp2.example.com/sse", "is_active": False},
    )
    assert r.status_code == status.HTTP_200_OK
    assert r.json()["url"] == "https://mcp2.example.com/sse"
    assert r.json()["is_active"] is False

    r = aux_client.delete(f"{MCP}/{mcp_id}", headers=superuser_token_headers)
    assert r.status_code == status.HTTP_200_OK
    r = aux_client.get(f"{MCP}/{mcp_id}", headers=superuser_token_headers)
    assert r.status_code == status.HTTP_404_NOT_FOUND


# SSRF-hostile URLs: non-https schemes, no scheme, embedded credentials,
# and hosts that resolve to loopback/private/link-local/unspecified ranges
# (including decimal/hex-encoded and IPv6-literal encodings).
_HOSTILE_MCP_URLS = [
    "http://mcp.example.com/",  # non-https scheme
    "ftp://mcp.example.com/",  # non-https scheme
    "example.com/foo",  # no scheme
    "https://user:pass@mcp.example.com/",  # embedded credentials
    "https://127.0.0.1/",  # IPv4 loopback
    "https://localhost:1",  # loopback name
    "https://10.0.0.5",  # private RFC1918
    "https://169.254.169.254/latest/meta-data/",  # cloud metadata (link-local)
    "https://0.0.0.0/",  # unspecified
    "https://[::1]/",  # IPv6 loopback literal
    "https://[fc00::1]/",  # IPv6 unique-local
    "https://[fe80::1]/",  # IPv6 link-local
    "https://2130706433/",  # decimal-encoded 127.0.0.1
    "https://0x7f000001/",  # hex-encoded 127.0.0.1
    "https:///nohost",  # missing host
    # alternative IPv4 literal encodings libc (inet_aton) resolves to
    # private/loopback/metadata — must not slip through as DNS names:
    "https://0177.0.0.1/",  # octal -> 127.0.0.1
    "https://127.1/",  # short-form -> 127.0.0.1
    "https://0300.0250.0.1/",  # octal octets -> 192.168.0.1
    "https://192.168.001.001/",  # leading-zero octets -> 192.168.1.1
    "https://169.254.169.254./",  # FQDN trailing dot -> metadata
    "https://0X7f000001/",  # uppercase hex -> 127.0.0.1
    "https://192.168.0.0x1/",  # dotted-hex -> 192.168.0.1
    "https://[::ffff:127.0.0.1]/",  # IPv4-mapped IPv6 -> loopback
    "https://foo.localhost/",  # loopback subdomain
]


@pytest.mark.parametrize("url", _HOSTILE_MCP_URLS)
def test_mcp_rejects_hostile_url(
    aux_client: TestClient, superuser_token_headers: dict[str, str], url: str
) -> None:
    r = aux_client.post(
        f"{MCP}/",
        headers=superuser_token_headers,
        json={"name": f"mcp-{random_lower_string()[:12]}", "url": url},
    )
    assert r.status_code == status.HTTP_422_UNPROCESSABLE_ENTITY
    assert r.json()["code"] == "validation_error"


@pytest.mark.parametrize(
    "url",
    [
        "https://mcp.example.com/sse",
        "https://8.8.8.8/",
        "https://[2606:4700:4700::1111]/",  # public IPv6 literal
    ],
)
def test_mcp_accepts_public_https_url(
    aux_client: TestClient, superuser_token_headers: dict[str, str], url: str
) -> None:
    r = aux_client.post(
        f"{MCP}/",
        headers=superuser_token_headers,
        json={"name": f"mcp-{random_lower_string()[:12]}", "url": url},
    )
    assert r.status_code == status.HTTP_200_OK
    assert r.json()["url"] == url


def test_mcp_update_revalidates_url(
    aux_client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    r = aux_client.post(
        f"{MCP}/",
        headers=superuser_token_headers,
        json={
            "name": f"mcp-{random_lower_string()[:12]}",
            "url": "https://mcp.example.com/sse",
        },
    )
    assert r.status_code == status.HTTP_200_OK
    mcp_id = r.json()["id"]

    # a hostile url on update is rejected the same way as on create
    r = aux_client.put(
        f"{MCP}/{mcp_id}",
        headers=superuser_token_headers,
        json={"url": "https://169.254.169.254/latest/meta-data/"},
    )
    assert r.status_code == status.HTTP_422_UNPROCESSABLE_ENTITY
    assert r.json()["code"] == "validation_error"

    # omitting url (None / unset) leaves the field untouched — still OK
    r = aux_client.put(
        f"{MCP}/{mcp_id}",
        headers=superuser_token_headers,
        json={"is_active": False},
    )
    assert r.status_code == status.HTTP_200_OK
    assert r.json()["url"] == "https://mcp.example.com/sse"
    assert r.json()["is_active"] is False


def test_mcp_config_not_echoed(
    aux_client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    r = aux_client.post(
        f"{MCP}/",
        headers=superuser_token_headers,
        json={
            "name": f"mcp-{random_lower_string()[:12]}",
            "url": "https://mcp.example.com/sse",
            "config": {"secret_token": "S3CR3T"},
        },
    )
    assert r.status_code == status.HTTP_200_OK
    assert "config" not in r.json()
    assert "S3CR3T" not in r.text
    mcp_id = r.json()["id"]

    # the write-only config must not leak through reads either
    r = aux_client.get(f"{MCP}/{mcp_id}", headers=superuser_token_headers)
    assert r.status_code == status.HTTP_200_OK
    assert "config" not in r.json()
    assert "S3CR3T" not in r.text


def test_mcp_update_and_delete_missing_is_404(
    aux_client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    missing = uuid.uuid4()
    r = aux_client.put(
        f"{MCP}/{missing}", headers=superuser_token_headers, json={"name": "x"}
    )
    assert r.status_code == status.HTTP_404_NOT_FOUND
    r = aux_client.delete(f"{MCP}/{missing}", headers=superuser_token_headers)
    assert r.status_code == status.HTTP_404_NOT_FOUND


# --- max_length boundaries (#74) ---
#
# Every AI create/update string field must mirror its DB VARCHAR(n) limit so
# an over-long value is rejected at the schema (422) instead of blowing up at
# the DB layer (DataError -> 500). Per field we assert: len == n is accepted,
# len == n + 1 is a 422 with the standard validation_error envelope.


def _unique_name(n: int) -> str:
    """A collision-resistant lowercase string of exactly ``n`` characters."""
    suffix = random_lower_string()  # 32 random chars -> unique enough
    if n <= len(suffix):
        return suffix[:n]
    return "a" * (n - len(suffix)) + suffix


# valid public https host so a too-long url fails on length (string_too_long),
# never on the SSRF validator; padded on the path to an exact character count.
_URL_PREFIX = "https://mcp.example.com/"


def _value_of_len(field: str, n: int) -> str:
    if field == "url":
        return _URL_PREFIX + "a" * (n - len(_URL_PREFIX))
    return _unique_name(n)


def _base_create_payload(resource: str) -> tuple[str, dict[str, object]]:
    if resource == "agent":
        return AGENTS, {"name": _unique_name(10)}
    if resource == "tool":
        return TOOLS, {"name": _unique_name(10), "tool_type": "brave_search"}
    return MCP, {"name": _unique_name(10), "url": "https://mcp.example.com/sse"}


# (resource, field, max_length) — mirrors the DB columns in each models.py.
_CREATE_MAX_LENGTHS = [
    ("agent", "name", 64),
    ("agent", "description", 255),
    ("tool", "name", 64),
    ("tool", "description", 255),
    ("tool", "tool_type", 32),
    ("mcp", "name", 128),
    ("mcp", "url", 512),
]


@pytest.mark.parametrize(("resource", "field", "max_len"), _CREATE_MAX_LENGTHS)
def test_create_enforces_max_length(
    aux_client: TestClient,
    superuser_token_headers: dict[str, str],
    resource: str,
    field: str,
    max_len: int,
) -> None:
    endpoint, base = _base_create_payload(resource)

    # len == max_len -> accepted, and the exact-length value round-trips.
    at_limit = {**base, field: _value_of_len(field, max_len)}
    r = aux_client.post(f"{endpoint}/", headers=superuser_token_headers, json=at_limit)
    assert r.status_code == status.HTTP_200_OK
    assert len(str(r.json()[field])) == max_len

    # len == max_len + 1 -> 422 validation_error (fresh name so the over-long
    # field, not a duplicate-name conflict, is what trips the request).
    over = {**base, "name": _unique_name(10), field: _value_of_len(field, max_len + 1)}
    r = aux_client.post(f"{endpoint}/", headers=superuser_token_headers, json=over)
    assert r.status_code == status.HTTP_422_UNPROCESSABLE_ENTITY
    assert r.json()["code"] == "validation_error"


# (resource, field, max_length) for the update schemas — ToolUpdate has no
# tool_type field, so tool_type is create-only here.
_UPDATE_MAX_LENGTHS = [
    ("agent", "name", 64),
    ("agent", "description", 255),
    ("tool", "name", 64),
    ("tool", "description", 255),
    ("mcp", "name", 128),
    ("mcp", "url", 512),
]


def test_mcp_url_length_check_precedes_ssrf_validator(
    aux_client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    # An over-length url whose host ALSO fails the SSRF check must fail on
    # LENGTH: StringConstraints(max_length=512) runs before the AfterValidator,
    # so pydantic reports string_too_long and never reaches the SSRF value_error.
    # This locks the #72 (SSRF validator) + #74 (length constraint) ordering.
    blocked_prefix = "https://127.0.0.1/"  # loopback -> SSRF-hostile
    url = blocked_prefix + "a" * (513 - len(blocked_prefix))
    assert len(url) == 513

    r = aux_client.post(
        f"{MCP}/",
        headers=superuser_token_headers,
        json={"name": _unique_name(10), "url": url},
    )
    assert r.status_code == status.HTTP_422_UNPROCESSABLE_ENTITY
    assert r.json()["code"] == "validation_error"
    url_errors = [e for e in r.json()["details"] if e["loc"][-1] == "url"]
    assert url_errors, r.json()["details"]
    assert all(e["type"] == "string_too_long" for e in url_errors)


@pytest.mark.parametrize(("resource", "field", "max_len"), _UPDATE_MAX_LENGTHS)
def test_update_enforces_max_length(
    aux_client: TestClient,
    superuser_token_headers: dict[str, str],
    resource: str,
    field: str,
    max_len: int,
) -> None:
    endpoint, base = _base_create_payload(resource)
    r = aux_client.post(f"{endpoint}/", headers=superuser_token_headers, json=base)
    assert r.status_code == status.HTTP_200_OK
    row_id = r.json()["id"]

    r = aux_client.put(
        f"{endpoint}/{row_id}",
        headers=superuser_token_headers,
        json={field: _value_of_len(field, max_len)},
    )
    assert r.status_code == status.HTTP_200_OK
    assert len(str(r.json()[field])) == max_len

    r = aux_client.put(
        f"{endpoint}/{row_id}",
        headers=superuser_token_headers,
        json={field: _value_of_len(field, max_len + 1)},
    )
    assert r.status_code == status.HTTP_422_UNPROCESSABLE_ENTITY
    assert r.json()["code"] == "validation_error"
