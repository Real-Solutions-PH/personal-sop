"""Redis cache of a credential's model list (one hour per credential).

The key carries the credential id; every change to the key, the base URL or
the credential's existence calls :func:`invalidate`. A Redis outage degrades
to "no cache": the list is fetched live and the request still succeeds.
"""

import json
import logging
import uuid
from typing import Any

import redis
from redis.exceptions import RedisError

from app.core.config import settings

logger = logging.getLogger(__name__)

TTL_SECONDS = 3600

_client: redis.Redis | None = None


def _redis() -> redis.Redis:
    global _client
    if _client is None:
        _client = redis.Redis.from_url(settings.REDIS_URL, decode_responses=True)
    return _client


def key(credential_id: uuid.UUID) -> str:
    return f"ai_providers:models:{credential_id}"


def get(credential_id: uuid.UUID) -> dict[str, Any] | None:
    try:
        raw = _redis().get(key(credential_id))
    except RedisError:
        logger.warning("model-list cache read failed")
        return None
    if not isinstance(raw, str):
        return None
    try:
        value = json.loads(raw)
    except ValueError:
        return None
    return value if isinstance(value, dict) else None


def put(credential_id: uuid.UUID, value: dict[str, Any]) -> None:
    try:
        _redis().set(key(credential_id), json.dumps(value), ex=TTL_SECONDS)
    except RedisError:
        logger.warning("model-list cache write failed")


def invalidate(credential_id: uuid.UUID) -> None:
    try:
        _redis().delete(key(credential_id))
    except RedisError:
        logger.warning("model-list cache invalidate failed")
