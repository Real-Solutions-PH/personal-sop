"""Per-user and per-client-address guards (``rate_limit.guarded``).

Production has no load balancer or WAF in front of the API, only a
Cloudflare tunnel, so these guards are what stops one user, or one address,
flooding the model-backed and account routes.
"""

import uuid
from types import SimpleNamespace

import pytest
import redis
from fastapi import FastAPI
from fastapi.testclient import TestClient
from redis.exceptions import RedisError

from app.core.config import settings
from app.modules.iam.deps import get_current_user
from app.shared import rate_limit
from app.shared.errors import register_exception_handlers
from app.shared.rate_limit import NullBackend, RedisTokenBucket, guarded

CF = "CF-Connecting-IP"


def _redis_or_skip() -> "redis.Redis":
    client: redis.Redis = redis.Redis.from_url(settings.REDIS_URL)
    try:
        client.ping()
    except RedisError:
        pytest.skip("Redis not reachable at settings.REDIS_URL")
    return client


def _app(user_ids: list[uuid.UUID]) -> TestClient:
    """One guarded route; the caller is whichever user id is first in the list
    (tests rotate it to act as different users)."""
    app = FastAPI()
    register_exception_handlers(app)

    @app.post("/spend", dependencies=[guarded("ai", "spend")])
    def spend() -> dict[str, bool]:
        return {"ok": True}

    app.dependency_overrides[get_current_user] = lambda: SimpleNamespace(id=user_ids[0])
    return TestClient(app)


@pytest.fixture
def bucket_of_two(monkeypatch: pytest.MonkeyPatch) -> None:
    """A real Redis bucket of 2 requests, with no refill during the test."""
    client = _redis_or_skip()
    monkeypatch.setitem(
        rate_limit.guards,
        "ai",
        RedisTokenBucket(client, capacity=2, refill_per_second=0.0001),
    )
    monkeypatch.setattr(settings, "CLIENT_IP_HEADER", CF)


def _ip() -> str:
    # A fresh address per test: buckets live in the shared Redis.
    return f"203.0.113.{uuid.uuid4().int % 250}-{uuid.uuid4().hex[:6]}"


@pytest.mark.usefixtures("bucket_of_two")
def test_one_user_is_stopped_after_its_budget_even_from_new_addresses() -> None:
    users = [uuid.uuid4()]
    c = _app(users)
    assert c.post("/spend", headers={CF: _ip()}).status_code == 200
    assert c.post("/spend", headers={CF: _ip()}).status_code == 200
    r = c.post("/spend", headers={CF: _ip()})
    assert r.status_code == 429
    assert r.json()["code"] == "too_many_requests"


@pytest.mark.usefixtures("bucket_of_two")
def test_one_address_is_stopped_after_its_budget_even_with_new_users() -> None:
    users = [uuid.uuid4()]
    c = _app(users)
    ip = _ip()
    for _ in range(2):
        users[0] = uuid.uuid4()
        assert c.post("/spend", headers={CF: ip}).status_code == 200
    users[0] = uuid.uuid4()
    assert c.post("/spend", headers={CF: ip}).status_code == 429
    # Another address, another fresh user: unaffected.
    users[0] = uuid.uuid4()
    assert c.post("/spend", headers={CF: _ip()}).status_code == 200


@pytest.mark.usefixtures("bucket_of_two")
def test_without_the_header_setting_the_forwarded_address_is_ignored(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Unset: a client-supplied header must not mint new buckets; every request
    # from this test client shares its peer address.
    monkeypatch.setattr(settings, "CLIENT_IP_HEADER", None)
    users = [uuid.uuid4()]
    c = _app(users)
    peer_requests = 0
    for _ in range(3):
        users[0] = uuid.uuid4()
        r = c.post("/spend", headers={CF: _ip()})
        if r.status_code == 200:
            peer_requests += 1
    # The shared test-client address may already hold spent tokens from an
    # earlier run, so at most two pass; the third never does.
    assert peer_requests <= 2


def test_guard_is_a_noop_with_the_null_backend(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setitem(rate_limit.guards, "ai", NullBackend())
    c = _app([uuid.uuid4()])
    for _ in range(5):
        assert c.post("/spend").status_code == 200


def test_unknown_guard_is_refused_at_import_time() -> None:
    with pytest.raises(ValueError, match="unknown rate-limit guard"):
        guarded("nope", "x")


def test_client_ip_prefers_the_configured_header(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "CLIENT_IP_HEADER", CF)
    request = SimpleNamespace(
        headers={CF: " 198.51.100.7 "}, client=SimpleNamespace(host="10.0.0.5")
    )
    assert rate_limit.client_ip(request) == "198.51.100.7"  # type: ignore[arg-type]
    request.headers = {}
    assert rate_limit.client_ip(request) == "10.0.0.5"  # type: ignore[arg-type]


def test_build_guard_backends_follow_their_settings() -> None:
    assert isinstance(rate_limit._build_backend(0), NullBackend)
    assert isinstance(rate_limit._build_backend(30), RedisTokenBucket)
