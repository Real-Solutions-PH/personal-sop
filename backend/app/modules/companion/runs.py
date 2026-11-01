"""A Fern reply runs on its own, apart from the request that asked for it.

Seen live (2026-10-31): a reply that thought for two minutes held the
phone's request open the whole time; closing the chat or the app dropped
the stream, and the app could only poll for the finished reply, with
nothing to show meanwhile.

Now the turn runs on its own thread and writes every AG-UI event it makes
to a Redis stream, one per reply (``fern:events:{user}:{run}``). Any number
of readers tail that stream: the request that asked, and later the app
coming back to the chat (``GET /companion/messages/{id}/events``), which
replays what happened so far and then goes on live. A reader leaving
changes nothing for the turn.

The run is claimed by the question's id, so the app sending the same
question again (a retry after a dropped connection) reads the reply already
being written instead of starting a second one. A run that failed frees its
claim, so a Retry does ask again.
"""

import logging
import threading
import uuid
from collections.abc import AsyncIterator, Callable

import redis
import redis.asyncio as aioredis
from ag_ui.core import BaseEvent, EventType, RunErrorEvent

from app.core.config import settings
from app.modules.companion import gate

log = logging.getLogger(__name__)

Sink = Callable[[BaseEvent], None]

# A reply's events are kept this long after its last event, for an app that
# comes back to the chat later.
EVENTS_SECONDS = 3600
# At most this many events per reply (a long reasoning stream is the bulk).
MAX_EVENTS = 20_000
# A reader is never silent for longer than this: a model that thinks
# without a word sends nothing, and the phone (45 s) and Cloudflare in
# front of the API (100 s) both cut a silent response.
HEARTBEAT_SECONDS = 15.0
PING = ": ping\n\n"
# A running reply says it is alive at every heartbeat; a reply whose task
# died (a deploy, a crash) is known to be gone once this lapses.
ALIVE_SECONDS = int(HEARTBEAT_SECONDS * 3)
FAILED = RunErrorEvent(message="Couldn't finish that reply.", code="reply_failed")


def _events(user_id: uuid.UUID, run_id: str) -> str:
    return f"fern:events:{user_id}:{run_id}"


def _claim(user_id: uuid.UUID, run_id: str) -> str:
    return f"fern:claim:{user_id}:{run_id}"


def _alive(user_id: uuid.UUID, run_id: str) -> str:
    return f"fern:alive:{user_id}:{run_id}"


def _redis() -> redis.Redis:
    return gate._redis()


def _encode(event: BaseEvent) -> str:
    # The AG-UI wire form (what ``EventEncoder`` puts after ``data:``).
    return event.model_dump_json(by_alias=True, exclude_none=True)


def start(
    user_id: uuid.UUID,
    run_id: str,
    work: Callable[[Sink], None],
    *,
    on_heartbeat: Callable[[], None] = lambda: None,
    heartbeat_s: float = HEARTBEAT_SECONDS,
) -> bool:
    """Run ``work(sink)`` on its own thread unless this reply already runs
    (or ran and is still kept). Every event ``sink`` hears is appended to the
    reply's stream; ``on_heartbeat`` runs every ``heartbeat_s`` while the
    work runs, whoever is reading. True when this call started it."""
    r = _redis()
    if not r.set(_claim(user_id, run_id), "1", nx=True, ex=EVENTS_SECONDS):
        return False
    key = _events(user_id, run_id)
    # A failed earlier run of this question (freed for a Retry) leaves its
    # events; the new run starts a clean stream.
    r.delete(key)
    r.set(_alive(user_id, run_id), "1", ex=ALIVE_SECONDS)
    failed = False

    def sink(event: BaseEvent) -> None:
        nonlocal failed
        if event.type == EventType.RUN_ERROR:
            failed = True
        pipe = r.pipeline()
        pipe.xadd(key, {"e": _encode(event)}, maxlen=MAX_EVENTS, approximate=True)
        pipe.expire(key, EVENTS_SECONDS)
        pipe.execute()

    done = threading.Event()

    def beat() -> None:
        while not done.wait(heartbeat_s):
            try:
                r.set(_alive(user_id, run_id), "1", ex=ALIVE_SECONDS)
                on_heartbeat()
            except Exception as exc:  # noqa: BLE001 - a missed beat never ends the reply
                log.warning("companion heartbeat failed: %s", type(exc).__name__)

    def run() -> None:
        try:
            work(sink)
        except Exception as exc:  # noqa: BLE001 - reported as an event, never as text
            log.warning("companion turn failed: %s", type(exc).__name__, exc_info=True)
            try:
                sink(FAILED)
            except Exception:  # noqa: BLE001 - Redis gone too; the alive mark lapses
                pass
        finally:
            done.set()
            try:
                # A failed reply may be asked again (Retry) as soon as its
                # readers hear it ended, so its claim goes first.
                if failed:
                    r.delete(_claim(user_id, run_id))
                # Readers end here: after the reply and everything the turn
                # does once it is out (the push, what Fern learns). The end
                # is written before the alive mark goes, so no reader takes
                # the gap for a dead task.
                r.xadd(key, {"end": "1"}, maxlen=MAX_EVENTS, approximate=True)
                r.expire(key, EVENTS_SECONDS)
                r.delete(_alive(user_id, run_id))
            except Exception as exc:  # noqa: BLE001
                log.warning("companion run end failed: %s", type(exc).__name__)

    threading.Thread(target=beat, name="companion-beat", daemon=True).start()
    threading.Thread(target=run, name="companion-turn", daemon=True).start()
    return True


def exists(user_id: uuid.UUID, run_id: str) -> bool:
    """Whether this reply's events are still kept (running or recent)."""
    return bool(_redis().exists(_events(user_id, run_id)))


def frame(entry_id: str, data: str) -> str:
    return f"id: {entry_id}\ndata: {data}\n\n"


async def tail(
    user_id: uuid.UUID,
    run_id: str,
    after: str | None = None,
    *,
    heartbeat_s: float = HEARTBEAT_SECONDS,
) -> AsyncIterator[str]:
    """The reply's events after ``after`` (a stream id from ``Last-Event-ID``;
    none replays from the start), then each new one as it is written, as
    SSE frames whose ``id`` resumes the read. A ping after every
    ``heartbeat_s`` without one. Ends when the turn ends, or with a
    ``RUN_ERROR`` once a turn that stopped saying it is alive is gone."""
    key = _events(user_id, run_id)
    client = aioredis.Redis.from_url(settings.REDIS_URL, decode_responses=True)
    cursor = after or "0-0"
    try:
        while True:
            got = await client.xread(
                {key: cursor}, block=int(heartbeat_s * 1000), count=500
            )
            if not got:
                if not await client.exists(_alive(user_id, run_id)):
                    # Nothing new and nobody writing: the run's task is gone.
                    yield frame(cursor, _encode(FAILED))
                    await client.delete(_claim(user_id, run_id))
                    return
                yield PING
                continue
            for _key, entries in got:
                for entry_id, fields in entries:
                    cursor = entry_id
                    if "end" in fields:
                        return
                    yield frame(entry_id, fields.get("e", "{}"))
    finally:
        await client.aclose()
