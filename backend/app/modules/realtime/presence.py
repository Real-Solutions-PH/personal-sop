"""Who has a live ``/events/stream`` right now.

Each open stream holds one member of the sorted set ``presence:{user}``,
scored with the instant it expires; the stream refreshes it on every loop
turn (at most one heartbeat apart) and removes it on disconnect. A crashed
instance leaves members that simply age out. Senders use it to decide
between a live event alone and an Expo push as well.
"""

import time
import uuid
from collections.abc import Callable

import redis
import redis.asyncio as aioredis
from redis.exceptions import RedisError

from app.core.config import settings


def presence_key(user_id: uuid.UUID) -> str:
    return f"presence:{user_id}"


def ttl_seconds() -> int:
    # Two missed heartbeats and the connection counts as gone.
    return settings.EVENTS_HEARTBEAT_SECONDS * 2 + 5


async def touch(client: aioredis.Redis, user_id: uuid.UUID, conn_id: str) -> None:
    key = presence_key(user_id)
    try:
        await client.zadd(key, {conn_id: time.time() + ttl_seconds()})
        await client.expire(key, ttl_seconds())
    except RedisError:
        pass


async def leave(client: aioredis.Redis, user_id: uuid.UUID, conn_id: str) -> None:
    try:
        await client.zrem(presence_key(user_id), conn_id)
    except RedisError:
        pass


_client: redis.Redis | None = None


def _redis() -> redis.Redis:
    global _client
    if _client is None:
        _client = redis.Redis.from_url(settings.REDIS_URL, decode_responses=True)
    return _client


def _redis_probe(user_id: uuid.UUID) -> bool:
    key = presence_key(user_id)
    client = _redis()
    pipe = client.pipeline()
    pipe.zremrangebyscore(key, "-inf", time.time())
    pipe.zcard(key)
    _removed, live = pipe.execute()
    return int(live) > 0


# One named seam: tests swap the probe, never the redis client.
Probe = Callable[[uuid.UUID], bool]
probe: Probe = _redis_probe


def is_live(user_id: uuid.UUID) -> bool:
    """True when the user has at least one open stream. A Redis outage reads
    as "not live", so the caller falls back to push rather than silence."""
    try:
        return probe(user_id)
    except RedisError:
        return False
