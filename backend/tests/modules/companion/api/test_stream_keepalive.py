"""Fern's reply stream stays alive through long thinking, and a dropped
stream can be resumed from the stored reply.

Seen live on 2026-10-30: a model that reasoned for over a minute sent
nothing, the phone gave up on the silent stream and said it was offline,
while the server went on to store the reply."""

import threading
import time
import uuid
from typing import Any, cast

import pytest
from ag_ui.core import BaseEvent, CustomEvent, RunStartedEvent
from fastapi.testclient import TestClient
from sqlmodel import Session

from app.modules.companion import gate, turn
from app.modules.companion.turn import TurnStream
from app.shared import events
from app.shared.context import Ctx
from tests.modules.capture.api.helpers import install, parse_agui, say, user

# The turn's events here never read the context.
NO_CTX = cast(Ctx, None)


def drain(gen: Any) -> list[str]:
    return list(gen)


# ------------------------------------------------------------ the stream


def test_a_silent_turn_streams_pings_and_beats() -> None:
    beats: list[float] = []

    def work(sink: turn.Sink) -> None:
        sink(RunStartedEvent(thread_id="t", run_id="r"))
        time.sleep(0.35)

    out = drain(
        turn.stream_events(
            work, heartbeat_s=0.05, on_heartbeat=lambda: beats.append(time.monotonic())
        )
    )
    pings = [x for x in out if x == turn.PING]
    assert len(pings) >= 3
    assert len(beats) == len(pings)
    # A ping is an SSE comment: never a data frame, so never an event.
    assert all(not p.startswith("data:") for p in pings)
    assert not any('"thinking"' in x for x in out)


def test_beats_go_on_after_the_client_is_gone_until_the_turn_ends() -> None:
    done = threading.Event()
    beats: list[int] = []

    def work(sink: turn.Sink) -> None:
        sink(RunStartedEvent(thread_id="t", run_id="r"))
        time.sleep(0.4)
        done.set()

    gen = turn.stream_events(
        work, heartbeat_s=0.05, on_heartbeat=lambda: beats.append(1)
    )
    first = next(gen)
    assert "RUN_STARTED" in first
    gen.close()  # the phone dropped the stream
    # close() returns only once the worker has ended, beating meanwhile.
    assert done.is_set()
    assert len(beats) >= 4


def test_a_failing_heartbeat_never_ends_the_reply() -> None:
    def work(sink: turn.Sink) -> None:
        time.sleep(0.15)
        sink(RunStartedEvent(thread_id="t", run_id="r"))

    def boom() -> None:
        raise RuntimeError("redis down")

    out = drain(turn.stream_events(work, heartbeat_s=0.05, on_heartbeat=boom))
    assert any("RUN_STARTED" in x for x in out)


def test_each_model_call_says_it_is_thinking_once() -> None:
    seen: list[BaseEvent] = []
    s = TurnStream(ctx=NO_CTX, thread_id="t", run_id="r", sink=seen.append)
    s.model_started(1)
    s.model_started(2)
    thinking = [e for e in seen if isinstance(e, CustomEvent) and e.name == "thinking"]
    assert [e.value for e in thinking] == [{"turn": 1}, {"turn": 2}]


def test_a_streamed_turn_says_thinking_before_its_text(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    api = user(client, db, accounts=False)
    api.assign("chat")
    install(monkeypatch, say("Hello there."))
    r = client.post("/api/v1/companion/ask/stream", headers=api.h, json={"text": "hi"})
    evs = parse_agui(r.text)
    names = [e.get("name") or e["type"] for e in evs]
    assert names.count("thinking") == 1
    assert names.index("thinking") < names.index("TEXT_MESSAGE_START")


# ------------------------------------------------------------ the run mark


def test_a_heartbeat_keeps_the_run_and_its_slot_alive(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(gate, "SLOT_SECONDS", 2)
    uid, run = uuid.uuid4(), str(uuid.uuid4())
    r = gate._redis()
    with gate.running(uid, run), gate.turn_slot(uid, "chat", run):
        r.expire(gate._run(uid, run), 1)
        r.expire(gate._slot(uid, "chat"), 1)
        gate.refresh_run(uid, run, "chat")
        assert r.ttl(gate._run(uid, run)) == 2
        assert r.ttl(gate._slot(uid, "chat")) == 2
        # Longer than the mark's life, kept alive by beats.
        for _ in range(3):
            time.sleep(1)
            gate.refresh_run(uid, run, "chat")
        assert gate.is_running(uid, run)
    assert not gate.is_running(uid, run)


def test_a_beat_never_extends_another_runs_slot() -> None:
    uid = uuid.uuid4()
    r = gate._redis()
    r.set(gate._slot(uid, "chat"), "other", ex=5)
    gate.refresh_run(uid, "mine", "chat")
    assert r.ttl(gate._slot(uid, "chat")) <= 5


def test_a_mark_left_by_a_crashed_turn_expires(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(gate, "SLOT_SECONDS", 1)
    uid, run = uuid.uuid4(), str(uuid.uuid4())
    gate._redis().set(gate._run(uid, run), "1", ex=gate.SLOT_SECONDS)
    assert gate.is_running(uid, run)
    time.sleep(1.2)
    assert not gate.is_running(uid, run)


# ------------------------------------------------------------ the reply read


def test_the_reply_read_says_running_done_or_failed(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    api = user(client, db, accounts=False)
    api.assign("chat")
    me = str(uuid.uuid4())
    path = f"/companion/messages/{me}/reply"

    with gate.running(api.user.id, me):
        assert api.get(path)["status"] == "running"
    api.get(path, status=404)  # never stored, not running

    install(monkeypatch, say("Hello there."))
    r = client.post(
        "/api/v1/companion/ask/stream",
        headers=api.h,
        json={"text": "hi", "id": me},
    )
    assert r.status_code == 200
    done = api.get(path)
    assert done["status"] == "done"
    assert [m["role"] for m in done["messages"]] == ["me", "sol"]
    assert done["messages"][1]["text"] == "Hello there."
    # Done whether or not a mark is still there.
    with gate.running(api.user.id, me):
        assert api.get(path)["status"] == "done"

    # Someone else's question reads as absent.
    other = user(client, db, accounts=False)
    other.get(path, status=404)


def test_a_question_stored_with_no_reply_reads_failed(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    from app.modules.companion import services

    api = user(client, db, accounts=False)
    api.assign("chat")
    me = uuid.uuid4()
    real = services._ask_ai

    def store_question_then_crash(ctx: Ctx, *_a: Any, **_kw: Any) -> Any:
        services._message(ctx, "me", "hi", [], me)
        ctx.commit()
        raise RuntimeError("worker died")

    monkeypatch.setattr(services, "_ask_ai", store_question_then_crash)
    install(monkeypatch, say("unused"))
    r = client.post(
        "/api/v1/companion/ask/stream",
        headers=api.h,
        json={"text": "hi", "id": str(me)},
    )
    assert "RUN_ERROR" in r.text
    monkeypatch.setattr(services, "_ask_ai", real)
    assert api.get(f"/companion/messages/{me}/reply")["status"] == "failed"


def test_a_finished_turn_publishes_its_reply(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    sent: list[tuple[uuid.UUID, str, dict[str, Any]]] = []
    monkeypatch.setattr(events, "sink", lambda u, t, d: sent.append((u, t, d)))
    api = user(client, db, accounts=False)
    api.assign("chat")
    install(monkeypatch, say("Hello there."))
    me = str(uuid.uuid4())
    r = client.post(
        "/api/v1/companion/ask/stream",
        headers=api.h,
        json={"text": "hi", "id": me},
    )
    reply = parse_agui(r.text)[-1]["result"]["messages"][1]
    hits = [x for x in sent if x[1] == "companion.reply"]
    assert len(hits) == 1
    uid, _, data = hits[0]
    assert uid == api.user.id
    assert data["message_id"] == me
    assert data["reply_id"] == reply["id"]
    assert "thread_id" in data
