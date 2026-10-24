"""One reply at a time in a chat.

Seen live: a message sent while Fern was still answering the one before
started a second reply beside the first. Both read the chat before either
had written to it, and the second came back empty.

A reply holds its chat's slot in Redis, so the rule holds across API tasks.
A message that arrives while the slot is held waits its turn: it is queued,
and it reads the chat after the reply before it is stored. Asking to stop
the running reply (the app's "Send now") sets a flag the reply checks
between steps; the reply then ends early, keeping what it already did, and
the waiting message goes next.
"""

import time
import uuid
from collections.abc import Callable, Iterator
from contextlib import contextmanager

import redis

from app.core.config import settings

# A reply's slot outlives any real reply. A slot left behind by a crashed
# task frees itself after this.
SLOT_SECONDS = 300
# How long a queued message waits for the reply before it, at most.
WAIT_SECONDS = 240
POLL_SECONDS = 0.25

_client: redis.Redis | None = None


def _redis() -> redis.Redis:
    global _client
    if _client is None:
        _client = redis.Redis.from_url(settings.REDIS_URL, decode_responses=True)
    return _client


def _slot(user_id: uuid.UUID, thread: str) -> str:
    return f"fern:turn:{user_id}:{thread}"


def _stop(user_id: uuid.UUID, run_id: str) -> str:
    # Keyed by the person too: nobody can stop someone else's reply.
    return f"fern:stop:{user_id}:{run_id}"


class Busy(Exception):
    """The reply ahead never finished within ``WAIT_SECONDS``."""


@contextmanager
def turn_slot(
    user_id: uuid.UUID,
    thread: str,
    run_id: str,
    *,
    on_wait: Callable[[str], None] = lambda holder: None,
) -> Iterator[None]:
    """Hold the chat's reply slot for ``run_id``, waiting while another
    reply holds it. ``on_wait`` hears once, with the running reply's id,
    that this one is queued."""
    r = _redis()
    key = _slot(user_id, thread)
    deadline = time.monotonic() + WAIT_SECONDS
    told = False
    while not r.set(key, run_id, nx=True, ex=SLOT_SECONDS):
        holder = str(r.get(key) or "")
        if not told and holder:
            on_wait(holder)
            told = True
        if time.monotonic() > deadline:
            raise Busy
        time.sleep(POLL_SECONDS)
    try:
        yield
    finally:
        # Free only our own slot: one that expired and was taken by the next
        # reply is that reply's.
        if r.get(key) == run_id:
            r.delete(key)
        r.delete(_stop(user_id, run_id))


def request_stop(user_id: uuid.UUID, run_id: str) -> None:
    """Ask the reply ``run_id`` to end at its next step."""
    _redis().set(_stop(user_id, run_id), "1", ex=SLOT_SECONDS)


def stop_requested(user_id: uuid.UUID, run_id: str) -> bool:
    return bool(_redis().exists(_stop(user_id, run_id)))
