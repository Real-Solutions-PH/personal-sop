"""Rate-limit seams.

Two kinds of limit share one token-bucket implementation:

- **Per tenant**, on every write route: :func:`rate_limited` calls
  :func:`check_rate_limit` with the request's :class:`TenantContext`, against
  :data:`backend` (a Redis bucket when ``RATE_LIMIT_PER_MINUTE`` > 0,
  otherwise the no-op :class:`NullBackend`).
- **Per user and per client address**, on the routes that spend money or
  touch the account at GoTrue: :func:`guarded` checks two buckets, one keyed
  on the caller's user id and one on their address, against the
  :data:`guards` backend of that class (``RATE_LIMIT_AI_PER_MINUTE``,
  ``RATE_LIMIT_ACCOUNT_PER_MINUTE``). Production has no load balancer or WAF
  in front of the API (only a Cloudflare tunnel), so these are where a
  flooding user or address is stopped.

The client address is ``CLIENT_IP_HEADER`` (``CF-Connecting-IP`` behind
Cloudflare) when set and present, else the address the ASGI server reports.
"""

import logging
import time
import uuid
from typing import Any, Protocol

import redis
from fastapi import Depends, HTTPException, Request, status
from redis.exceptions import RedisError

from app.core.config import settings
from app.modules.iam.deps import CurrentUser
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


def _build_backend(per_minute: int | None = None) -> RateLimitBackend:
    budget = settings.RATE_LIMIT_PER_MINUTE if per_minute is None else per_minute
    if budget > 0 and settings.REDIS_URL:
        client: redis.Redis = redis.Redis.from_url(settings.REDIS_URL)
        return RedisTokenBucket(
            client,
            capacity=budget,
            refill_per_second=budget / 60.0,
        )
    return NullBackend()


backend: RateLimitBackend = _build_backend()

# Route classes with their own per-user and per-address budget. Tests
# substitute an entry to exercise a class.
guards: dict[str, RateLimitBackend] = {
    "ai": _build_backend(settings.RATE_LIMIT_AI_PER_MINUTE),
    "account": _build_backend(settings.RATE_LIMIT_ACCOUNT_PER_MINUTE),
}


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


# Anonymous routes have no tenant, so their buckets are keyed on the client
# address instead: a name-based UUID stands in for the tenant id, keeping the
# one ``backend`` seam (and its test substitution) for both kinds of caller.
_CLIENT_NAMESPACE = uuid.UUID("6f1d3c2a-8b4e-5a17-9c60-2d7e1f0b4a93")


def client_ip(request: Request) -> str:
    """The caller's address: ``CLIENT_IP_HEADER`` when configured and sent
    (Cloudflare sets ``CF-Connecting-IP`` on every request it forwards and
    nothing else can reach the API), else the address the ASGI server
    reports, which is the proxy's unless it trusts proxy headers."""
    if settings.CLIENT_IP_HEADER:
        forwarded = request.headers.get(settings.CLIENT_IP_HEADER, "").strip()
        if forwarded:
            return forwarded
    return request.client.host if request.client else "unknown"


def client_bucket(request: Request) -> uuid.UUID:
    """The per-client-address bucket id (a name-based UUID of the address)."""
    return uuid.uuid5(_CLIENT_NAMESPACE, client_ip(request))


def rate_limited_by_client(key: str, *, cost: int = 1) -> Any:
    """``dependencies=[...]`` marker for routes that take no credentials:
    limits per client address through the same backend as
    :func:`rate_limited`."""

    def _check(request: Request) -> None:
        if not backend.allow(client_bucket(request), f"client:{key}", cost):
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Too many requests. Try again in a minute.",
            )

    return Depends(_check)


def guarded(guard: str, key: str, *, cost: int = 1) -> Any:
    """``dependencies=[...]`` marker for a route class with its own budget
    (``"ai"`` or ``"account"``): the caller's user bucket and their client
    address bucket must both allow the request. One user cannot flood from
    many addresses, and one address cannot flood with many accounts."""
    if guard not in guards:
        raise ValueError(f"unknown rate-limit guard {guard!r}")

    def _check(request: Request, user: CurrentUser) -> None:
        limiter = guards[guard]
        if not limiter.allow(user.id, f"{guard}:user:{key}", cost) or not limiter.allow(
            client_bucket(request), f"{guard}:client:{key}", cost
        ):
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Too many requests. Try again in a minute.",
            )

    return Depends(_check)
