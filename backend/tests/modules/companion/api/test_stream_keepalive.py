"""Fern's reply stream stays alive through long thinking, and a dropped
stream can be resumed from the stored reply.

Seen live on 2026-10-30: a model that reasoned for over a minute sent
nothing, the phone gave up on the silent stream and said it was offline,
while the server went on to store the reply."""

import asyncio
import threading
import time
import uuid
from collections.abc import AsyncIterator
from typing import Any, cast

import pytest
from ag_ui.core import BaseEvent, CustomEvent, RunStartedEvent
from fastapi.testclient import TestClient
from sqlmodel import Session

from app.modules.companion import gate, runs, turn
from app.modules.companion.turn import TurnStream
from app.shared import events
from app.shared.context import Ctx
from tests.modules.capture.api.helpers import install, parse_agui, say, user

# The turn's events here never read the context.
NO_CTX = cast(Ctx, None)


def drain(agen: AsyncIterator[str], *, stop_after: int | None = None) -> list[str]:
    async def go() -> list[str]:
        out: list[str] = []
        async for x in agen:
            out.append(x)
            if stop_after is not None and len(out) >= stop_after:
                break
        await agen.aclose()  # type: ignore[attr-defined]
        return out

    return asyncio.run(go())


def frames(out: list[str]) -> list[dict[str, Any]]:
    return parse_agui("".join(x for x in out if x != runs.PING))


# ------------------------------------------------------------ the run


def test_a_silent_turn_streams_pings_and_beats() -> None:
    uid, run = uuid.uuid4(), str(uuid.uuid4())
    beats: list[int] = []
    heard = threading.Event()

    def work(sink: turn.Sink) -> None:
        sink(RunStartedEvent(thread_id="t", run_id=run))
        # Silent until the reader has had three pings.
        assert heard.wait(30)

    async def read() -> list[str]:
        out: list[str] = []
        async for x in runs.tail(uid, run, heartbeat_s=0.2):
            out.append(x)
            if out.count(runs.PING) == 3:
                heard.set()
        return out

    # Redis times out a blocking read on its 100 ms clock: beats of 0.2 s.
    assert runs.start(
        uid, run, work, heartbeat_s=0.2, on_heartbeat=lambda: beats.append(1)
    )
    out = asyncio.run(read())
    pings = [x for x in out if x == runs.PING]
    assert len(pings) >= 3
    assert len(beats) >= 1
    # A ping is an SSE comment: never a data frame, so never an event.
    assert all(not p.startswith("data:") for p in pings)
    assert [f["type"] for f in frames(out)] == ["RUN_STARTED"]


def test_the_turn_goes_on_after_the_reader_leaves() -> None:
    uid, run = uuid.uuid4(), str(uuid.uuid4())
    done = threading.Event()
    beats: list[int] = []

    def work(sink: turn.Sink) -> None:
        sink(RunStartedEvent(thread_id="t", run_id=run))
        time.sleep(0.4)
        sink(CustomEvent(name="late", value={}))
        done.set()

    runs.start(uid, run, work, heartbeat_s=0.05, on_heartbeat=lambda: beats.append(1))
    first = drain(runs.tail(uid, run, heartbeat_s=0.05), stop_after=1)
    assert "RUN_STARTED" in first[0]  # the phone dropped the stream here
    assert done.wait(2)
    assert len(beats) >= 4
    # Coming back reads everything, the part written while away included.
    names = [f.get("name") or f["type"] for f in frames(drain(runs.tail(uid, run)))]
    assert names == ["RUN_STARTED", "late"]


def test_a_reader_resumes_after_the_last_event_it_saw() -> None:
    uid, run = uuid.uuid4(), str(uuid.uuid4())

    def work(sink: turn.Sink) -> None:
        for n in range(3):
            sink(CustomEvent(name=f"e{n}", value={}))

    runs.start(uid, run, work)
    out = drain(runs.tail(uid, run))
    ids = [ln[4:] for x in out for ln in x.splitlines() if ln.startswith("id: ")]
    assert len(ids) == 3
    again = frames(drain(runs.tail(uid, run, ids[0])))
    assert [f["name"] for f in again] == ["e1", "e2"]


def test_sending_the_same_question_again_reads_the_running_reply() -> None:
    uid, run = uuid.uuid4(), str(uuid.uuid4())
    calls: list[int] = []
    go = threading.Event()

    def work(sink: turn.Sink) -> None:
        calls.append(1)
        go.wait(2)
        sink(CustomEvent(name="answer", value={}))

    assert runs.start(uid, run, work)
    assert not runs.start(uid, run, work)  # the resend
    go.set()
    assert [f["name"] for f in frames(drain(runs.tail(uid, run)))] == ["answer"]
    assert calls == [1]


def test_a_failed_reply_can_be_asked_again_on_a_clean_stream() -> None:
    uid, run = uuid.uuid4(), str(uuid.uuid4())

    def boom(sink: turn.Sink) -> None:
        sink(CustomEvent(name="first", value={}))
        raise RuntimeError("model down")

    runs.start(uid, run, boom)
    first = frames(drain(runs.tail(uid, run)))
    assert [f.get("name") or f["type"] for f in first] == ["first", "RUN_ERROR"]
    # Never the exception's text.
    assert first[-1]["message"] == "Couldn't finish that reply."

    def ok(sink: turn.Sink) -> None:
        sink(CustomEvent(name="second", value={}))

    assert runs.start(uid, run, ok)  # the Retry
    assert [f["name"] for f in frames(drain(runs.tail(uid, run)))] == ["second"]


def test_a_reply_whose_task_died_ends_its_readers_with_an_error() -> None:
    uid, run = uuid.uuid4(), str(uuid.uuid4())
    r = gate._redis()
    # What a task killed mid-reply leaves: events, no end, no alive mark.
    r.xadd(runs._events(uid, run), {"e": '{"type":"RUN_STARTED"}'})
    r.set(runs._claim(uid, run), "1")
    out = frames(drain(runs.tail(uid, run, heartbeat_s=0.2)))
    assert [f["type"] for f in out] == ["RUN_STARTED", "RUN_ERROR"]
    assert not r.exists(runs._claim(uid, run))  # a Retry may ask again


def test_a_failing_heartbeat_never_ends_the_reply() -> None:
    uid, run = uuid.uuid4(), str(uuid.uuid4())

    def work(sink: turn.Sink) -> None:
        time.sleep(0.15)
        sink(RunStartedEvent(thread_id="t", run_id=run))

    def boom() -> None:
        raise RuntimeError("redis down")

    runs.start(uid, run, work, heartbeat_s=0.05, on_heartbeat=boom)
    out = drain(runs.tail(uid, run, heartbeat_s=0.05))
    assert any("RUN_STARTED" in x for x in out)


# ------------------------------------------------------------ thinking


def test_thinking_streams_apart_from_the_reply_and_before_it() -> None:
    seen: list[BaseEvent] = []
    s = TurnStream(ctx=NO_CTX, thread_id="t", run_id="r", sink=seen.append)
    s.model_started(1)
    for w in ["The", " person", " wants", " protein."]:
        s.reasoning(w)
    s.text("Rice and egg come to about 9 g of protein in all.")
    s.finished({})
    types = [e.type.value for e in seen]
    assert types.index("REASONING_START") < types.index("REASONING_MESSAGE_CONTENT")
    assert types.index("REASONING_END") < types.index("TEXT_MESSAGE_START")
    thought = "".join(
        getattr(e, "delta", "")
        for e in seen
        if e.type.value == "REASONING_MESSAGE_CONTENT"
    )
    assert thought == "The person wants protein."
    # The first piece goes at once; the rest is gathered, not sent per word.
    assert types.count("REASONING_MESSAGE_CONTENT") < 4


def test_a_streamed_reply_shows_the_models_thinking(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    api = user(client, db, accounts=False)
    api.assign("chat")
    install(monkeypatch, say("Hello there.", thinking="They said hi, so greet them."))
    r = client.post("/api/v1/companion/ask/stream", headers=api.h, json={"text": "hi"})
    evs = parse_agui(r.text)
    types = [e["type"] for e in evs]
    assert types.index("REASONING_MESSAGE_CONTENT") < types.index("TEXT_MESSAGE_START")
    thought = "".join(
        e["delta"] for e in evs if e["type"] == "REASONING_MESSAGE_CONTENT"
    )
    assert thought == "They said hi, so greet them."
    # Thinking is never part of the stored answer.
    done = evs[-1]["result"]["messages"][1]
    assert done["text"] == "Hello there."


def test_the_provider_keeps_streamed_reasoning() -> None:
    from langchain_core.messages import AIMessageChunk

    from app.modules.ai_providers import public as ai_public

    model = ai_public._chat_openai()(model="m", api_key="k", base_url="http://x")
    chunk = {"choices": [{"index": 0, "delta": {"reasoning_content": "Let me think"}}]}
    gen = model._convert_chunk_to_generation_chunk(chunk, AIMessageChunk, None)
    assert gen is not None
    assert gen.message.additional_kwargs["reasoning_content"] == "Let me think"


# ------------------------------------------------------------ coming back


def test_coming_back_replays_the_reply_then_ends(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    api = user(client, db, accounts=False)
    api.assign("chat")
    install(monkeypatch, say("Hello there.", thinking="Greet them."))
    me = str(uuid.uuid4())
    path = f"/api/v1/companion/messages/{me}/events"
    assert client.get(path, headers=api.h).status_code == 404
    live = parse_agui(
        client.post(
            "/api/v1/companion/ask/stream", headers=api.h, json={"text": "hi", "id": me}
        ).text
    )
    back = client.get(path, headers=api.h)
    assert back.status_code == 200
    assert back.headers["content-type"].startswith("text/event-stream")
    assert parse_agui(back.text) == live
    # Someone else never reads it.
    other = user(client, db, accounts=False)
    assert client.get(path, headers=other.h).status_code == 404


def test_a_resent_question_is_answered_once(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    api = user(client, db, accounts=False)
    api.assign("chat")
    model = install(monkeypatch, say("Hello there."))
    me = str(uuid.uuid4())
    body = {"text": "hi", "id": me}
    one = parse_agui(
        client.post("/api/v1/companion/ask/stream", headers=api.h, json=body).text
    )
    two = parse_agui(
        client.post("/api/v1/companion/ask/stream", headers=api.h, json=body).text
    )
    assert one == two
    assert len(model.seen) == 1


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
