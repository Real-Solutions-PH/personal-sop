"""Per-tenant rate-limit seam.

A deliberately minimal choke point: every write route calls
:func:`check_rate_limit` with the request's :class:`TenantContext`. Which
backend enforces it is decided at module load from settings — a Redis token
bucket keyed on ``(tenant_id, key)`` when a positive
``RATE_LIMIT_PER_MINUTE`` budget is configured, otherwise the no-op
:class:`NullBackend`.
"""

import logging
import time
import uuid
from typing import Any, Protocol

import redis
from fastapi import Depends, HTTPException, status
from redis.exceptions import RedisError

from app.core.config import settings
from app.shared.tenancy import TenantContext, TenantDep

logger = logging.getLogger(__name__)


class RateLimitBackend(Protocol):
    """Decides whether a tenant may spend ``cost`` units against ``key``."""

    def allow(self, tenant_id: uuid.UUID, key: str, cost: int) -> bool: ...


class NullBackend:
    """Default backend: no limiting."""

    def allow(self, tenant_id: uuid.UUID, key: str, cost: int) -> bool:  # noqa: ARG002
        return True


def refill_and_consume(
    *,
    tokens: float,
    ts: float,
    now: float,
    refill_per_second: float,
    capacity: float,
    cost: float,
) -> tuple[bool, float]:
    """Token-bucket decision, in pure Python (mirrors the Redis Lua script).

    Refills ``tokens`` for the time since ``ts`` (capped at ``capacity``) and
    spends ``cost`` if available. Returns ``(allowed, tokens_after)``.
    """
    elapsed = max(0.0, now - ts)
    tokens = min(capacity, tokens + elapsed * refill_per_second)
    if tokens >= cost:
        return True, tokens - cost
    return False, tokens


# Atomic server-side token bucket. Keeps the read-modify-write on the Redis
# side so concurrent workers cannot race the same bucket. Mirrors
# refill_and_consume above (rate is per-millisecond here).
_TOKEN_BUCKET_LUA = """
local key = KEYS[1]
local now = tonumber(ARGV[1])
local rate = tonumber(ARGV[2])
local capacity = tonumber(ARGV[3])
local cost = tonumber(ARGV[4])
local ttl = tonumber(ARGV[5])
local data = redis.call('HMGET', key, 'tokens', 'ts')
local tokens = tonumber(data[1])
local ts = tonumber(data[2])
if tokens == nil then tokens = capacity; ts = now end
local elapsed = now - ts
if elapsed < 0 then elapsed = 0 end
tokens = math.min(capacity, tokens + elapsed * rate)
local allowed = 0
if tokens >= cost then
    tokens = tokens - cost
    allowed = 1
end
redis.call('HMSET', key, 'tokens', tokens, 'ts', now)
redis.call('PEXPIRE', key, ttl)
return allowed
"""


class RedisTokenBucket:
    """Per-``(tenant, key)`` token bucket backed by Redis.

    Fails open: if Redis is unreachable the request is allowed (availability
    over strictness) and the outage is logged, rather than 429-ing every
    caller because the limiter is down.
    """

    def __init__(
        self,
        client: redis.Redis,
        *,
        capacity: int,
        refill_per_second: float,
        fail_open: bool = True,
    ) -> None:
        self._capacity = capacity
        self._rate_per_ms = refill_per_second / 1000.0
        self._fail_open = fail_open
        # Idle buckets expire once a full refill would have topped them up.
        self._ttl_ms = (
            int(capacity / refill_per_second * 1000) + 1000
            if refill_per_second > 0
            else 60_000
        )
        self._script = client.register_script(_TOKEN_BUCKET_LUA)

    def allow(self, tenant_id: uuid.UUID, key: str, cost: int) -> bool:
        bucket_key = f"ratelimit:{tenant_id}:{key}"
        now_ms = int(time.time() * 1000)
        try:
            result = self._script(
                keys=[bucket_key],
                args=[now_ms, self._rate_per_ms, self._capacity, cost, self._ttl_ms],
            )
            return bool(result)
        except RedisError:
            logger.warning(
                "rate-limit backend unavailable; allowing request (fail-open)",
                exc_info=True,
            )
            return self._fail_open


def _build_backend() -> RateLimitBackend:
    if settings.RATE_LIMIT_PER_MINUTE > 0 and settings.REDIS_URL:
        client: redis.Redis = redis.Redis.from_url(settings.REDIS_URL)
        return RedisTokenBucket(
            client,
            capacity=settings.RATE_LIMIT_PER_MINUTE,
            refill_per_second=settings.RATE_LIMIT_PER_MINUTE / 60.0,
        )
    return NullBackend()


backend: RateLimitBackend = _build_backend()


def check_rate_limit(tenant: TenantContext, key: str = "api", *, cost: int = 1) -> None:
    """Raise 429 (standard error envelope) when the tenant is over its limit."""
    if not backend.allow(tenant.tenant_id, key, cost):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Rate limit exceeded for tenant",
        )


def rate_limited(key: str = "api", *, cost: int = 1) -> Any:
    """Route-level ``dependencies=[rate_limited(...)]`` marker.

    Resolves the tenant from the authenticated user and runs the rate check
    without touching the route's OpenAPI request/response models.
    """

    def _check(tenant: TenantDep) -> None:
        check_rate_limit(tenant, key, cost=cost)

    return Depends(_check)
