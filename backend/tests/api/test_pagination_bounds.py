"""Bounded pagination on list routes.

Every list route resolves its ``skip``/``limit`` through the shared pagination
dependency, so an out-of-range page request is rejected at the edge with 422
instead of reaching the database (a negative offset previously 500'd; an
oversized limit previously ran an unbounded scan).
"""

from fastapi.testclient import TestClient

from app.core.config import settings


def _url(path: str) -> str:
    return f"{settings.API_V1_STR}{path}"


def test_limit_over_max_is_rejected(
    client: TestClient, normal_user_token_headers: dict[str, str]
) -> None:
    r = client.get(_url("/items/?limit=101"), headers=normal_user_token_headers)
    assert r.status_code == 422


def test_negative_limit_is_rejected(
    client: TestClient, normal_user_token_headers: dict[str, str]
) -> None:
    r = client.get(_url("/items/?limit=-1"), headers=normal_user_token_headers)
    assert r.status_code == 422


def test_negative_skip_is_rejected(
    client: TestClient, normal_user_token_headers: dict[str, str]
) -> None:
    r = client.get(_url("/items/?skip=-1"), headers=normal_user_token_headers)
    assert r.status_code == 422


def test_limit_at_max_is_accepted(
    client: TestClient, normal_user_token_headers: dict[str, str]
) -> None:
    r = client.get(_url("/items/?limit=100&skip=0"), headers=normal_user_token_headers)
    assert r.status_code == 200


def test_default_page_is_accepted(
    client: TestClient, normal_user_token_headers: dict[str, str]
) -> None:
    r = client.get(_url("/items/"), headers=normal_user_token_headers)
    assert r.status_code == 200
