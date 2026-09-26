"""Write routes go through the per-tenant rate-limit seam.

With the default NullBackend nothing changes; with a denying backend the
write routes return 429 while reads stay untouched.
"""

import uuid

import pytest
from fastapi.testclient import TestClient

from app.core.config import settings
from app.shared import rate_limit


class _DenyBackend:
    def allow(self, tenant_id: uuid.UUID, key: str, cost: int) -> bool:  # noqa: ARG002
        return False


def test_create_item_returns_429_when_backend_denies(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(rate_limit, "backend", _DenyBackend())

    r = client.post(
        f"{settings.API_V1_STR}/items/",
        headers=normal_user_token_headers,
        json={"title": "rate limited"},
    )

    assert r.status_code == 429
    body = r.json()
    assert set(body) == {"code", "message", "details"}
    assert body["code"] == "too_many_requests"


def test_reads_bypass_the_rate_limit_seam(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(rate_limit, "backend", _DenyBackend())

    r = client.get(f"{settings.API_V1_STR}/items/", headers=normal_user_token_headers)

    assert r.status_code == 200


def test_create_item_unaffected_by_default_null_backend(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
) -> None:
    r = client.post(
        f"{settings.API_V1_STR}/items/",
        headers=normal_user_token_headers,
        json={"title": "not limited"},
    )

    assert r.status_code == 200
