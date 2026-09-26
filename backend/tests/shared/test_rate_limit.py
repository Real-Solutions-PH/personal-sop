"""Unit tests for the per-tenant rate-limit seam."""

import uuid

import pytest
import redis
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from redis.exceptions import RedisError

from app.core.config import settings
from app.shared import rate_limit
from app.shared.errors import register_exception_handlers
from app.shared.rate_limit import (
    NullBackend,
    RedisTokenBucket,
    check_rate_limit,
    refill_and_consume,
)
from app.shared.tenancy import TenantContext


class DenyBackend:
    """Backend that denies everything and records what it was asked."""

    def __init__(self) -> None:
        self.calls: list[tuple[uuid.UUID, str, int]] = []

    def allow(self, tenant_id: uuid.UUID, key: str, cost: int) -> bool:
        self.calls.append((tenant_id, key, cost))
        return False


def _ctx() -> TenantContext:
    return TenantContext(tenant_id=uuid.uuid4(), user_id=uuid.uuid4())


def test_null_backend_always_allows() -> None:
    backend = NullBackend()
    assert backend.allow(uuid.uuid4(), "api", 1) is True


def test_check_rate_limit_is_a_noop_with_null_backend() -> None:
    check_rate_limit(_ctx())  # must not raise


def test_check_rate_limit_raises_429_when_backend_denies(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    deny = DenyBackend()
    monkeypatch.setattr(rate_limit, "backend", deny)
    ctx = _ctx()

    with pytest.raises(HTTPException) as exc_info:
        check_rate_limit(ctx, "items", cost=3)

    assert exc_info.value.status_code == 429
    assert deny.calls == [(ctx.tenant_id, "items", 3)]


def test_429_uses_the_error_envelope(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(rate_limit, "backend", DenyBackend())

    app = FastAPI()
    register_exception_handlers(app)

    @app.get("/limited")
    def limited() -> dict[str, bool]:
        check_rate_limit(_ctx())
        return {"ok": True}

    client = TestClient(app, raise_server_exceptions=False)
    r = client.get("/limited")

    assert r.status_code == 429
    body = r.json()
    assert set(body) == {"code", "message", "details"}
    assert body["code"] == "too_many_requests"


# --- token-bucket algorithm (pure, no Redis) --------------------------------


def test_refill_and_consume_spends_when_tokens_available() -> None:
    allowed, remaining = refill_and_consume(
        tokens=5, ts=0.0, now=0.0, refill_per_second=1, capacity=5, cost=1
    )
    assert allowed is True
    assert remaining == 4


def test_refill_and_consume_denies_when_empty() -> None:
    allowed, remaining = refill_and_consume(
        tokens=0, ts=0.0, now=0.0, refill_per_second=1, capacity=5, cost=1
    )
    assert allowed is False
    assert remaining == 0


def test_refill_and_consume_refills_over_time_capped_at_capacity() -> None:
    # 10s elapsed at 1 token/s would add 10, but capacity caps at 5.
    allowed, remaining = refill_and_consume(
        tokens=0, ts=0.0, now=10.0, refill_per_second=1, capacity=5, cost=1
    )
    assert allowed is True
    assert remaining == 4


# --- Redis-backed bucket (skipped when Redis is unreachable) ----------------


def _redis_or_skip() -> "redis.Redis":
    client: redis.Redis = redis.Redis.from_url(settings.REDIS_URL)
    try:
        client.ping()
    except RedisError:
        pytest.skip("Redis not reachable at settings.REDIS_URL")
    return client


def test_redis_bucket_allows_up_to_capacity_then_denies() -> None:
    client = _redis_or_skip()
    # Tiny refill so the bucket does not top back up mid-test.
    bucket = RedisTokenBucket(client, capacity=2, refill_per_second=0.001)
    tenant = uuid.uuid4()
    key = f"test-{uuid.uuid4()}"
    assert bucket.allow(tenant, key, 1) is True
    assert bucket.allow(tenant, key, 1) is True
    assert bucket.allow(tenant, key, 1) is False


def test_redis_bucket_isolates_tenants() -> None:
    client = _redis_or_skip()
    bucket = RedisTokenBucket(client, capacity=1, refill_per_second=0.001)
    key = "shared-key"
    a, b = uuid.uuid4(), uuid.uuid4()
    assert bucket.allow(a, key, 1) is True
    assert bucket.allow(a, key, 1) is False
    # Different tenant, same key: its own full bucket.
    assert bucket.allow(b, key, 1) is True


def test_redis_bucket_fails_open_when_unreachable() -> None:
    dead: redis.Redis = redis.Redis.from_url("redis://localhost:1/0")
    bucket = RedisTokenBucket(dead, capacity=1, refill_per_second=1)
    assert bucket.allow(uuid.uuid4(), "api", 1) is True


def test_build_backend_is_null_when_disabled(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "RATE_LIMIT_PER_MINUTE", 0)
    assert isinstance(rate_limit._build_backend(), NullBackend)


def test_build_backend_is_redis_when_enabled(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "RATE_LIMIT_PER_MINUTE", 60)
    assert isinstance(rate_limit._build_backend(), RedisTokenBucket)
