"""Shared helpers for the social API tests."""

from typing import Any

from app.core.config import settings

API = f"{settings.API_V1_STR}/social"


def ok(r: Any, status: int = 200) -> Any:
    assert r.status_code == status, r.text
    return r.json() if r.content else None


def code(r: Any) -> str:
    body = r.json()
    detail = body.get("detail", body)
    if isinstance(detail, dict):
        return str(detail.get("code"))
    return str(body.get("code"))
