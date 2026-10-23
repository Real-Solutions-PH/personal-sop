"""The model-backed and account routes carry the per-user and per-address
guards; the plain write and read routes do not."""

import uuid

import pytest
from fastapi.testclient import TestClient

from app.core.config import settings
from app.shared import rate_limit

API = settings.API_V1_STR


class _DenyBackend:
    def __init__(self) -> None:
        self.keys: list[str] = []

    def allow(self, bucket: uuid.UUID, key: str, cost: int) -> bool:  # noqa: ARG002
        self.keys.append(key)
        return False


@pytest.fixture
def deny_ai(monkeypatch: pytest.MonkeyPatch) -> _DenyBackend:
    deny = _DenyBackend()
    monkeypatch.setitem(rate_limit.guards, "ai", deny)
    return deny


@pytest.fixture
def deny_account(monkeypatch: pytest.MonkeyPatch) -> _DenyBackend:
    deny = _DenyBackend()
    monkeypatch.setitem(rate_limit.guards, "account", deny)
    return deny


@pytest.mark.parametrize(
    ("method", "path", "body"),
    [
        ("post", "/companion/ask", {"text": "hi"}),
        ("post", "/companion/ask/stream", {"text": "hi"}),
        ("post", f"/companion/messages/{uuid.uuid4()}/speech", None),
        ("post", "/capture/", {"text": "spent 200 on lunch"}),
        ("post", "/capture/stream", {"text": "spent 200 on lunch"}),
        ("post", f"/capture/{uuid.uuid4()}/rerun", {}),
        ("post", "/fitness/meals/estimate", {"text": "rice and adobo"}),
    ],
)
def test_model_backed_routes_return_429_when_the_ai_guard_denies(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    deny_ai: _DenyBackend,
    method: str,
    path: str,
    body: dict[str, str] | None,
) -> None:
    r = getattr(client, method)(
        f"{API}{path}", headers=normal_user_token_headers, json=body
    )
    assert r.status_code == 429, r.text
    assert r.json()["code"] == "too_many_requests"
    assert deny_ai.keys and deny_ai.keys[0].startswith("ai:user:")


@pytest.mark.usefixtures("deny_ai")
def test_dictation_returns_429_when_the_ai_guard_denies(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
) -> None:
    r = client.post(
        f"{API}/capture/dictate",
        headers={
            **normal_user_token_headers,
            "Content-Type": "application/octet-stream",
        },
        content=b"\x00" * 16,
    )
    assert r.status_code == 429


def test_plain_writes_and_reads_ignore_the_ai_guard(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    deny_ai: _DenyBackend,
) -> None:
    assert (
        client.get(f"{API}/companion/", headers=normal_user_token_headers).status_code
        == 200
    )
    r = client.post(
        f"{API}/items/", headers=normal_user_token_headers, json={"title": "not AI"}
    )
    assert r.status_code == 200
    assert deny_ai.keys == []


def test_account_routes_return_429_when_the_account_guard_denies(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    deny_account: _DenyBackend,
) -> None:
    r = client.patch(
        f"{API}/users/me", headers=normal_user_token_headers, json={"full_name": "x"}
    )
    assert r.status_code == 429
    r = client.delete(f"{API}/users/me", headers=normal_user_token_headers)
    assert r.status_code == 429
    assert [k.split(":")[2] for k in deny_account.keys] == ["update-me", "delete-me"]


@pytest.mark.usefixtures("deny_account")
def test_account_guard_does_not_touch_the_profile_read(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
) -> None:
    assert (
        client.get(f"{API}/users/me", headers=normal_user_token_headers).status_code
        == 200
    )
