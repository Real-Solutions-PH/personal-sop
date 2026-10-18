"""Small HTTP helpers for the habits API tests."""

from typing import Any

from fastapi.testclient import TestClient

from app.core.config import settings

API = f"{settings.API_V1_STR}/habits"


def ok(r: Any, status: int = 200) -> Any:
    assert r.status_code == status, r.text
    return r.json()


def err(r: Any, status: int, code: str | None = None) -> dict[str, Any]:
    assert r.status_code == status, r.text
    body: dict[str, Any] = r.json()
    if code is not None:
        assert body["code"] == code, body
    return body


def make_habit(client: TestClient, headers: dict[str, str], **fields: Any) -> Any:
    body = {"name": "Read", **fields}
    return ok(client.post(f"{API}/", headers=headers, json=body))


def today(client: TestClient, headers: dict[str, str]) -> str:
    day: str = ok(client.get(f"{API}/today", headers=headers))["day"]
    return day
