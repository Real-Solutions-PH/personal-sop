"""Per-user realtime events over Redis Streams (ADR-0013).

``publish`` appends to the stream ``events:{user_id}`` (capped, expiring), and
the SSE endpoint (``app.modules.realtime``) tails it with ``XREAD BLOCK``. A
stream rather than plain pub/sub so a reconnecting client resumes from its
``Last-Event-ID`` without losing what arrived while it was away (replay window
``EVENTS_REPLAY_SECONDS``). Redis fans out across API instances.

Publishing is best-effort: an event is a nudge, never the record. Every event
also has a durable home (a row the client pulls or lists), so a Redis outage
degrades realtime to "on next refresh" and never loses data.
"""

import json
import logging
import uuid
from collections.abc import Callable
from typing import Any

import redis
from redis.exceptions import RedisError

from app.core.config import settings

logger = logging.getLogger(__name__)

STREAM_MAXLEN = 500

_client: redis.Redis | None = None


def stream_key(user_id: uuid.UUID) -> str:
    return f"events:{user_id}"


def _redis() -> redis.Redis:
    global _client
    if _client is None:
        _client = redis.Redis.from_url(settings.REDIS_URL, decode_responses=True)
    return _client


# One named seam: tests swap the sink, never the redis client.
Sink = Callable[[uuid.UUID, str, dict[str, Any]], None]


def _redis_sink(user_id: uuid.UUID, type_: str, data: dict[str, Any]) -> None:
    key = stream_key(user_id)
    client = _redis()
    pipe = client.pipeline()
    pipe.xadd(
        key,
        {"type": type_, "data": json.dumps(data, default=str)},
        maxlen=STREAM_MAXLEN,
        approximate=True,
    )
    pipe.expire(key, settings.EVENTS_REPLAY_SECONDS)
    pipe.execute()


sink: Sink = _redis_sink


def publish(user_id: uuid.UUID, type_: str, data: dict[str, Any]) -> None:
    try:
        sink(user_id, type_, data)
    except RedisError:
        logger.warning("event publish failed", extra={"event_type": type_})


def publish_many(user_ids: list[uuid.UUID], type_: str, data: dict[str, Any]) -> None:
    for uid in dict.fromkeys(user_ids):
        publish(uid, type_, data)
