"""``GET /events/stream`` end to end, over a real Redis and a real HTTP server.

Starlette's ``TestClient`` buffers a whole response before returning it, so
an endless SSE body would never come back; these tests run the app under
uvicorn on a free port and read the stream with httpx instead.
"""

import socket
import threading
import time
import uuid
from collections.abc import Generator, Iterator
from typing import Any

import httpx
import pytest
import uvicorn
from sqlmodel import Session

from app.core.config import settings
from app.main import app
from app.modules.realtime import public as realtime
from app.shared import events
from tests.utils.mobile import signed_in

pytestmark = pytest.mark.filterwarnings("ignore::DeprecationWarning")

API = settings.API_V1_STR


@pytest.fixture(scope="module")
def server() -> Generator[str, None, None]:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        port = s.getsockname()[1]
    config = uvicorn.Config(
        app,
        host="127.0.0.1",
        port=port,
        log_level="warning",
        timeout_graceful_shutdown=1,
    )
    srv = uvicorn.Server(config)
    thread = threading.Thread(target=srv.run, daemon=True)
    thread.start()
    deadline = time.monotonic() + 15
    while not srv.started:
        if time.monotonic() > deadline:
            raise RuntimeError("uvicorn did not start")
        time.sleep(0.05)
    yield f"http://127.0.0.1:{port}"
    srv.should_exit = True
    thread.join(10)


@pytest.fixture(autouse=True)
def quick_heartbeat(monkeypatch: pytest.MonkeyPatch) -> None:
    # The stream re-checks for a disconnect once per heartbeat.
    monkeypatch.setattr(settings, "EVENTS_HEARTBEAT_SECONDS", 1)


def frames(resp: httpx.Response) -> Iterator[dict[str, str]]:
    """Parse SSE frames; comment lines (heartbeats) and ``retry`` are skipped."""
    cur: dict[str, str] = {}
    for line in resp.iter_lines():
        if line == "":
            if "event" in cur:
                yield cur
            cur = {}
        elif line.startswith(":"):
            continue
        else:
            key, _, value = line.partition(": ")
            cur[key] = cur[key] + "\n" + value if key in cur else value


def first(resp: httpx.Response, *, type_: str | None = None) -> dict[str, str]:
    for f in frames(resp):
        if type_ is None or f["event"] == type_:
            return f
    raise AssertionError("stream ended")


def _client(base: str) -> httpx.Client:
    # trust_env=False: an HTTP proxy from the environment would buffer the
    # endless body and the stream would never arrive.
    return httpx.Client(base_url=base, timeout=httpx.Timeout(15.0), trust_env=False)


def test_requires_auth(server: str) -> None:
    with _client(server) as c:
        assert c.get(f"{API}/events/stream").status_code in (401, 403)


def test_receives_a_published_event_and_resumes(server: str, db: Session) -> None:
    user, headers = signed_in(db)
    events.publish(user.id, "test.one", {"n": 1})
    events.publish(user.id, "test.two", {"n": 2})
    with _client(server) as c:
        with c.stream(
            "GET", f"{API}/events/stream", headers={**headers, "Last-Event-ID": "0-0"}
        ) as r:
            assert r.status_code == 200
            assert r.headers["content-type"].startswith("text/event-stream")
            got = frames(r)
            one = next(got)
            two = next(got)
    assert (one["event"], one["data"]) == ("test.one", '{"n": 1}')
    assert two["event"] == "test.two"
    # Resume after the first id: only what came after it.
    with _client(server) as c:
        with c.stream(
            "GET",
            f"{API}/events/stream",
            headers={**headers, "Last-Event-ID": one["id"]},
        ) as r:
            resumed = first(r)
    assert (resumed["id"], resumed["event"]) == (two["id"], "test.two")


def test_live_event_and_presence(server: str, db: Session) -> None:
    user, headers = signed_in(db)
    assert not realtime.is_live(user.id)
    received: dict[str, Any] = {}
    stop = threading.Event()

    def keep_publishing() -> None:
        # Without Last-Event-ID the stream starts at "now"; keep nudging until
        # the reader is attached, so the test never races the connect.
        while not stop.is_set():
            events.publish(user.id, "test.live", {"ping": True})
            time.sleep(0.2)

    with _client(server) as c:
        with c.stream("GET", f"{API}/events/stream", headers=headers) as r:
            pub = threading.Thread(target=keep_publishing, daemon=True)
            pub.start()
            try:
                received = first(r, type_="test.live")
                assert realtime.is_live(user.id)
            finally:
                stop.set()
                pub.join(2)
    assert received["data"] == '{"ping": true}'
    # The connection leaves the presence set once the server notices.
    deadline = time.monotonic() + 10
    while realtime.is_live(user.id) and time.monotonic() < deadline:
        time.sleep(0.2)
    assert not realtime.is_live(user.id)


def test_social_message_reaches_members_stream_only(server: str, db: Session) -> None:
    ana, ana_h = signed_in(db)
    ben, ben_h = signed_in(db)
    cy, cy_h = signed_in(db)
    social = f"{API}/social"
    with _client(server) as c:
        chat = c.post(
            f"{social}/chats/direct", headers=ana_h, json={"user_id": str(ben.id)}
        ).json()
        msg = c.post(
            f"{social}/chats/{chat['id']}/messages", headers=ana_h, json={"text": "hi"}
        ).json()
        with c.stream(
            "GET", f"{API}/events/stream", headers={**ben_h, "Last-Event-ID": "0-0"}
        ) as r:
            got = first(r, type_="chat.message")
    assert (
        uuid.UUID(msg["id"]) and msg["id"] in got["data"] and chat["id"] in got["data"]
    )
    assert "hi" not in got["data"]  # ids, never the content
    # Cy is not a member: nothing was ever written to Cy's stream.
    import redis as redis_sync

    r_sync = redis_sync.Redis.from_url(settings.REDIS_URL, decode_responses=True)
    try:
        cy_len: Any = r_sync.xlen(events.stream_key(cy.id))
        assert cy_len == 0
        ana_len: Any = r_sync.xlen(events.stream_key(ana.id))
        assert ana_len >= 1  # the sender's other devices
    finally:
        r_sync.close()
    del cy_h


def test_open_streams_hold_no_database_connection(server: str, db: Session) -> None:
    # A stream lives for as long as the app is open. If it kept its auth
    # session checked out, a handful of open apps would drain the pool and
    # every other route would time out waiting for a connection.
    from app.core.db import engine

    _, headers = signed_in(db)
    before = engine.pool.checkedout()  # type: ignore[attr-defined]
    with _client(server) as c1, _client(server) as c2, _client(server) as c3:
        with (
            c1.stream("GET", f"{API}/events/stream", headers=headers) as r1,
            c2.stream("GET", f"{API}/events/stream", headers=headers) as r2,
            c3.stream("GET", f"{API}/events/stream", headers=headers) as r3,
        ):
            for r in (r1, r2, r3):
                assert r.status_code == 200
                # The "retry" preamble arrives once the body has started, so
                # the route's dependencies have all run by now.
                next(r.iter_lines())
            assert engine.pool.checkedout() <= before  # type: ignore[attr-defined]
