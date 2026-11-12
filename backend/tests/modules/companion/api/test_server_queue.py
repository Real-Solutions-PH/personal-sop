"""Fern's server-side queue: every message the app sends is stored on the
server at once (``companion_ask``) and answered there, in order, one turn
at a time per person, whether or not the app is still open.

Kai, 2026-11-12: messages typed while Fern was answering waited on the
phone and went only when the app was opened again. Now the phone hands
each message to the server the moment it is sent, and can close.

The model is substituted only at ``ai_providers.public.model_factory`` (the
scripted model in the capture helpers); the push sender and the live-stream
probe at their usual seams (``push.push_sender``, ``presence.probe``)."""

import threading
import time
import uuid
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import timedelta
from typing import Any

import pytest
from fastapi.testclient import TestClient
from langchain_core.messages import AIMessage, BaseMessage
from sqlmodel import Session, col, select

from app.core.config import settings
from app.modules.ai_providers import public as ai_public
from app.modules.companion import queue, services
from app.modules.companion.models import CompanionAsk, CompanionMessage
from app.modules.realtime import presence
from app.modules.tasks.models import TaskSettings
from app.shared import push
from app.shared.owned import utcnow
from tests.modules.capture.api.helpers import (
    Api,
    ScriptedModel,
    call,
    parse_agui,
    say,
    user,
)

API = settings.API_V1_STR
TOKEN = "ExponentPushToken[fern-queue-test]"


@dataclass
class Pushes:
    sent: list[push.PushMessage] = field(default_factory=list)
    live: set[uuid.UUID] = field(default_factory=set)


@pytest.fixture()
def pushes(monkeypatch: pytest.MonkeyPatch) -> Pushes:
    rec = Pushes()

    def sender(messages: list[push.PushMessage]) -> list[push.PushTicket]:
        rec.sent.extend(messages)
        return [push.PushTicket(token=m.token, ok=True) for m in messages]

    monkeypatch.setattr(settings, "PUSH_ENABLED", True)
    monkeypatch.setattr(push, "push_sender", sender)
    monkeypatch.setattr(presence, "probe", lambda uid: uid in rec.live)
    return rec


class GatedModel(ScriptedModel):
    """Answers in script order, but each call first waits for its gate (a
    test-held ``threading.Event``) when one is set for that call."""

    gates: dict[int, threading.Event] = {}
    calls: int = 0
    entered: list[threading.Event] = []

    def _next(self, messages: list[BaseMessage]) -> AIMessage:
        n = self.calls
        self.calls += 1
        if n < len(self.entered):
            self.entered[n].set()
        gate = self.gates.get(n)
        if gate is not None:
            assert gate.wait(30), "the test never released the model"
        return super()._next(messages)


def chat_user(client: TestClient, db: Session) -> Api:
    api = user(client, db, accounts=False)
    api.assign("chat")
    api.post("/profile/push-devices", {"token": TOKEN, "platform": "ios"})
    return api


def uid(api: Api) -> uuid.UUID:
    return api.user.id  # type: ignore[attr-defined, no-any-return]


def enqueue(
    client: TestClient, api: Api, text: str, me: uuid.UUID, thread: uuid.UUID
) -> dict[str, Any]:
    r = client.post(
        f"{API}/companion/messages",
        headers=api.h,
        json={"text": text, "id": str(me), "thread_id": str(thread)},
    )
    assert r.status_code == 202, r.text
    return r.json()  # type: ignore[no-any-return]


def asks(db: Session, owner: uuid.UUID) -> list[CompanionAsk]:
    db.expire_all()
    return list(
        db.exec(
            select(CompanionAsk)
            .where(CompanionAsk.owner_id == owner)
            .order_by(col(CompanionAsk.created_at))
        ).all()
    )


def wait_for(check: Callable[[], bool], seconds: float = 20) -> None:
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        if check():
            return
        time.sleep(0.05)
    raise AssertionError("timed out waiting")


def status_of(db: Session, ask_id: uuid.UUID) -> str | None:
    db.expire_all()
    row = db.get(CompanionAsk, ask_id)
    return row.status if row else None


def replies(db: Session, owner: uuid.UUID) -> list[CompanionMessage]:
    db.expire_all()
    return list(
        db.exec(
            select(CompanionMessage)
            .where(
                CompanionMessage.owner_id == owner,
                CompanionMessage.role == "sol",
                col(CompanionMessage.deleted_at).is_(None),
            )
            .order_by(col(CompanionMessage.created_at))
        ).all()
    )


@pytest.fixture()
def no_backoff(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(queue, "BACKOFF_SECONDS", (0.0, 0.0, 0.0))


# --------------------------------------------------------------- ordering


def test_a_second_message_waits_while_the_first_holds_the_turn(
    client: TestClient,
    db: Session,
    monkeypatch: pytest.MonkeyPatch,
    pushes: Pushes,  # noqa: ARG001
) -> None:
    """The second message is sent while the first reply is still being
    written: it is stored and queued, a second drain cannot start it, and
    it is answered after the first, reading the first reply."""
    api = chat_user(client, db)
    owner = uid(api)
    thread = uuid.uuid4()
    hold = threading.Event()
    entered = [threading.Event(), threading.Event()]
    model = GatedModel(
        script=[say("First answer."), say("Second answer.")],
        seen=[],
        opts=[],
        gates={0: hold},
        entered=entered,
    )
    monkeypatch.setattr(ai_public, "model_factory", lambda resolved: model)
    m1, m2 = uuid.uuid4(), uuid.uuid4()

    enqueue(client, api, "first question", m1, thread)
    # The first reply is inside its model call, holding the turn.
    assert entered[0].wait(20)
    assert status_of(db, m1) == "running"

    out = enqueue(client, api, "second question", m2, thread)
    assert out["status"] == "queued"
    # A drain started now (another API task, the worker) finds the turn
    # held and leaves the second message queued.
    assert queue.drain(owner) == 0
    time.sleep(0.3)
    assert status_of(db, m2) == "queued"
    assert not entered[1].is_set()

    hold.set()
    wait_for(lambda: status_of(db, m2) == "done")
    assert status_of(db, m1) == "done"
    texts = [r.text for r in replies(db, owner)]
    assert texts == ["First answer.", "Second answer."]
    # The second turn read the first reply in its history.
    second_call = model.seen[1]
    assert any("First answer." in str(m.content) for m in second_call)


# ------------------------------------------------------------ idempotency


def test_a_resent_message_never_runs_a_second_turn(
    client: TestClient,
    db: Session,
    monkeypatch: pytest.MonkeyPatch,
    pushes: Pushes,  # noqa: ARG001
) -> None:
    api = chat_user(client, db)
    owner = uid(api)
    thread, me = uuid.uuid4(), uuid.uuid4()
    model = GatedModel(script=[say("Only once.")], seen=[], opts=[])
    monkeypatch.setattr(ai_public, "model_factory", lambda resolved: model)

    enqueue(client, api, "hello", me, thread)
    again = enqueue(client, api, "hello", me, thread)
    assert again["id"] == str(me)
    wait_for(lambda: status_of(db, me) == "done")
    # The streaming route with the same id replays the stored reply.
    r = client.post(
        f"{API}/companion/ask/stream",
        headers=api.h,
        json={"text": "hello", "id": str(me), "thread_id": str(thread)},
    )
    assert r.status_code == 200
    events = parse_agui(r.text)
    assert events[-1]["type"] == "RUN_FINISHED", [
        (e["type"], e.get("name"), e.get("code")) for e in events
    ]
    enqueue(client, api, "hello", me, thread)
    time.sleep(0.3)

    assert model.calls == 1
    assert len(asks(db, owner)) == 1
    assert [r.text for r in replies(db, owner)] == ["Only once."]


def test_another_persons_message_id_is_refused(
    client: TestClient,
    db: Session,
    monkeypatch: pytest.MonkeyPatch,
    pushes: Pushes,  # noqa: ARG001
) -> None:
    a, b = chat_user(client, db), chat_user(client, db)
    model = GatedModel(script=[say("Hi.")], seen=[], opts=[])
    monkeypatch.setattr(ai_public, "model_factory", lambda resolved: model)
    me = uuid.uuid4()
    enqueue(client, a, "hello", me, uuid.uuid4())
    r = client.post(
        f"{API}/companion/messages",
        headers=b.h,
        json={"text": "mine now", "id": str(me), "thread_id": str(uuid.uuid4())},
    )
    assert r.status_code == 409
    wait_for(lambda: status_of(db, me) == "done")
    assert model.calls == 1


# ------------------------------------------------- the app closes mid-turn


def test_messages_sent_then_the_app_closed_are_all_answered_and_pushed(
    client: TestClient,
    db: Session,
    monkeypatch: pytest.MonkeyPatch,
    pushes: Pushes,  # noqa: ARG001
) -> None:
    """Three messages, no stream ever opened (the app was killed right
    after sending): each is logged and answered on the server, in order,
    and each reply is pushed because nobody is in the app."""
    api = chat_user(client, db)
    owner = uid(api)
    thread = uuid.uuid4()
    model = GatedModel(
        script=[
            say("", call("create_tasks", tasks=[{"title": "Buy milk"}])),
            say("Added buy milk."),
            say("", call("create_tasks", tasks=[{"title": "Call mom"}])),
            say("Added call mom."),
            say("Noted."),
        ],
        seen=[],
        opts=[],
    )
    monkeypatch.setattr(ai_public, "model_factory", lambda resolved: model)
    ids = [uuid.uuid4() for _ in range(3)]
    for text, me in zip(["add buy milk", "add call mom", "thanks!"], ids, strict=True):
        enqueue(client, api, text, me, thread)

    wait_for(lambda: all(status_of(db, i) == "done" for i in ids))
    assert [r.text for r in replies(db, owner)] == [
        "Added buy milk.",
        "Added call mom.",
        "Noted.",
    ]
    titles = {t["title"] for t in api.get("/tasks/")["data"]}
    assert {"Buy milk", "Call mom"} <= titles
    assert [p.body for p in pushes.sent] == [
        "Added buy milk.",
        "Added call mom.",
        "Noted.",
    ]


def test_the_reply_endpoint_says_queued_then_done(
    client: TestClient,
    db: Session,
    monkeypatch: pytest.MonkeyPatch,
    pushes: Pushes,  # noqa: ARG001
) -> None:
    api = chat_user(client, db)
    thread = uuid.uuid4()
    hold = threading.Event()
    entered = [threading.Event()]
    model = GatedModel(
        script=[say("One."), say("Two.")],
        seen=[],
        opts=[],
        gates={0: hold},
        entered=entered,
    )
    monkeypatch.setattr(ai_public, "model_factory", lambda resolved: model)
    m1, m2 = uuid.uuid4(), uuid.uuid4()
    enqueue(client, api, "one", m1, thread)
    assert entered[0].wait(20)
    enqueue(client, api, "two", m2, thread)
    assert api.get(f"/companion/messages/{m1}/reply")["status"] == "running"
    assert api.get(f"/companion/messages/{m2}/reply")["status"] == "queued"
    hold.set()
    wait_for(lambda: status_of(db, m2) == "done")
    out = api.get(f"/companion/messages/{m2}/reply")
    assert out["status"] == "done"
    assert out["messages"][-1]["text"] == "Two."


def test_the_stream_follows_a_message_queued_behind_another(
    client: TestClient,
    db: Session,
    monkeypatch: pytest.MonkeyPatch,
    pushes: Pushes,  # noqa: ARG001
) -> None:
    """The live stream still works when the app is open: a message queued
    behind a running reply hears ``queued``, then its own reply."""
    api = chat_user(client, db)
    thread = uuid.uuid4()
    hold = threading.Event()
    entered = [threading.Event()]
    model = GatedModel(
        script=[say("First."), say("Second.")],
        seen=[],
        opts=[],
        gates={0: hold},
        entered=entered,
    )
    monkeypatch.setattr(ai_public, "model_factory", lambda resolved: model)
    m1, m2 = uuid.uuid4(), uuid.uuid4()
    enqueue(client, api, "one", m1, thread)
    assert entered[0].wait(20)
    threading.Timer(0.5, hold.set).start()
    r = client.post(
        f"{API}/companion/ask/stream",
        headers=api.h,
        json={"text": "two", "id": str(m2), "thread_id": str(thread)},
    )
    events = parse_agui(r.text)
    names = [e.get("name") for e in events if e["type"] == "CUSTOM"]
    assert "queued" in names
    assert events[-1]["type"] == "RUN_FINISHED"
    sol = [m for m in events[-1]["result"]["messages"] if m["role"] == "sol"]
    assert sol[0]["text"] == "Second."


# --------------------------------------------- a turn that dies part way


def _orphan(
    db: Session,
    api: Api,
    me: uuid.UUID,
    thread: uuid.UUID,
    *,
    wrote: bool,
    store_question: bool,
) -> None:
    """A row as a worker that died mid-turn left it: ``running`` with a
    lease that lapsed, maybe its question stored, maybe a write done."""
    owner = uid(api)
    tenant = api.user.tenant_id  # type: ignore[attr-defined]
    past = utcnow() - timedelta(minutes=5)
    db.add(
        CompanionAsk(
            id=me,
            owner_id=owner,
            tenant_id=tenant,
            thread_id=thread,
            text="add buy milk",
            status="running",
            attempts=1,
            wrote=wrote,
            lease_until=past,
            started_at=past,
        )
    )
    if store_question:
        db.add(
            CompanionMessage(
                id=me,
                owner_id=owner,
                tenant_id=tenant,
                thread_id=None,
                role="me",
                text="add buy milk",
            )
        )
    db.commit()


def test_a_turn_whose_worker_died_before_any_write_runs_again(
    client: TestClient,
    db: Session,
    monkeypatch: pytest.MonkeyPatch,
    pushes: Pushes,  # noqa: ARG001
) -> None:
    api = chat_user(client, db)
    owner = uid(api)
    me, thread = uuid.uuid4(), uuid.uuid4()
    _orphan(db, api, me, thread, wrote=False, store_question=True)
    model = GatedModel(script=[say("Here you go.")], seen=[], opts=[])
    monkeypatch.setattr(ai_public, "model_factory", lambda resolved: model)

    assert queue.drain(owner) == 1

    row = asks(db, owner)[0]
    assert (row.status, row.attempts) == ("done", 2)
    assert [r.text for r in replies(db, owner)] == ["Here you go."]
    # The question was not stored twice, nor sent to the model twice.
    db.expire_all()
    mine = db.exec(
        select(CompanionMessage).where(
            CompanionMessage.owner_id == owner, CompanionMessage.role == "me"
        )
    ).all()
    assert [m.id for m in mine] == [me]
    said = [str(m.content) for m in model.seen[0] if m.type == "human"]
    assert sum("add buy milk" in s for s in said) == 1


def test_a_turn_that_died_after_a_write_asks_before_running_again(
    client: TestClient,
    db: Session,
    monkeypatch: pytest.MonkeyPatch,
    pushes: Pushes,  # noqa: ARG001
) -> None:
    """A write may already be stored: running it again could log it twice,
    so the chat shows "couldn't finish" with Retry instead."""
    api = chat_user(client, db)
    owner = uid(api)
    me, thread = uuid.uuid4(), uuid.uuid4()
    _orphan(db, api, me, thread, wrote=True, store_question=True)
    model = GatedModel(script=[say("Retried.")], seen=[], opts=[])
    monkeypatch.setattr(ai_public, "model_factory", lambda resolved: model)

    assert queue.drain(owner) == 0
    row = asks(db, owner)[0]
    assert (row.status, row.error) == ("failed", "interrupted")
    assert model.calls == 0
    out = api.get(f"/companion/messages/{me}/reply")
    assert (out["status"], out["error"]) == ("failed", "interrupted")

    # Retry: the person sends it again (same id).
    enqueue(client, api, "add buy milk", me, thread)
    wait_for(lambda: status_of(db, me) == "done")
    assert [r.text for r in replies(db, owner)] == ["Retried."]


def test_a_live_lease_is_never_taken_for_a_dead_worker(
    client: TestClient,
    db: Session,
    pushes: Pushes,  # noqa: ARG001
) -> None:
    api = chat_user(client, db)
    owner = uid(api)
    me, thread = uuid.uuid4(), uuid.uuid4()
    _orphan(db, api, me, thread, wrote=False, store_question=False)
    row = db.get(CompanionAsk, me)
    assert row is not None
    row.lease_until = utcnow() + timedelta(seconds=60)
    db.add(row)
    db.commit()
    assert queue.drain(owner) == 0
    assert status_of(db, me) == "running"


def test_the_sweeper_restarts_a_queue_left_by_a_dead_worker(
    client: TestClient,
    db: Session,
    monkeypatch: pytest.MonkeyPatch,
    pushes: Pushes,  # noqa: ARG001
) -> None:
    api = chat_user(client, db)
    owner = uid(api)
    me, thread = uuid.uuid4(), uuid.uuid4()
    _orphan(db, api, me, thread, wrote=False, store_question=False)
    model = GatedModel(script=[say("Back.")], seen=[], opts=[])
    monkeypatch.setattr(ai_public, "model_factory", lambda resolved: model)
    kicked: list[uuid.UUID] = []
    monkeypatch.setattr(queue, "kick", lambda o, delay=0.0: kicked.append(o))

    assert owner in queue.stalled_owners()
    queue.sweep()
    assert owner in kicked
    queue.drain(owner)
    assert status_of(db, me) == "done"


def test_a_turn_that_keeps_failing_stops_after_its_retries(
    client: TestClient,
    db: Session,
    monkeypatch: pytest.MonkeyPatch,
    pushes: Pushes,
    no_backoff: None,  # noqa: ARG001
) -> None:
    api = chat_user(client, db)
    owner = uid(api)
    tries: list[int] = []

    def boom(*_a: Any, **_k: Any) -> None:
        tries.append(1)
        raise RuntimeError("the turn broke")

    monkeypatch.setattr(services, "ask", boom)
    me, thread = uuid.uuid4(), uuid.uuid4()
    r = client.post(
        f"{API}/companion/ask/stream",
        headers=api.h,
        json={"text": "plan my day", "id": str(me), "thread_id": str(thread)},
    )
    events = parse_agui(r.text)
    assert events[-1]["type"] == "RUN_ERROR"
    assert len(tries) == queue.MAX_ATTEMPTS
    row = asks(db, owner)[0]
    assert (row.status, row.attempts) == ("failed", queue.MAX_ATTEMPTS)
    assert pushes.sent == []


def test_backoff_holds_the_next_attempt_and_the_messages_behind_it(
    client: TestClient,
    db: Session,
    monkeypatch: pytest.MonkeyPatch,
    pushes: Pushes,  # noqa: ARG001
) -> None:
    api = chat_user(client, db)
    owner = uid(api)
    monkeypatch.setattr(queue, "BACKOFF_SECONDS", (60.0, 60.0, 60.0))
    monkeypatch.setattr(queue, "kick", lambda owner, delay=0.0: None)
    calls: list[int] = []

    def boom(*_a: Any, **_k: Any) -> None:
        calls.append(1)
        raise RuntimeError("the turn broke")

    monkeypatch.setattr(services, "ask", boom)
    m1, m2 = uuid.uuid4(), uuid.uuid4()
    thread = uuid.uuid4()
    enqueue(client, api, "one", m1, thread)
    enqueue(client, api, "two", m2, thread)
    assert queue.drain(owner) == 0
    rows = {r.id: r for r in asks(db, owner)}
    assert rows[m1].status == "queued" and rows[m1].attempts == 1
    assert rows[m1].not_before is not None and rows[m1].not_before > utcnow()
    # Strict order: the second waits behind the first's backoff.
    assert rows[m2].status == "queued" and rows[m2].attempts == 0
    assert len(calls) == 1


# ---------------------------------------------------------------- pushes


def test_no_push_while_the_person_is_in_the_app(
    client: TestClient,
    db: Session,
    monkeypatch: pytest.MonkeyPatch,
    pushes: Pushes,  # noqa: ARG001
) -> None:
    api = chat_user(client, db)
    pushes.live.add(uid(api))
    model = GatedModel(script=[say("Here.")], seen=[], opts=[])
    monkeypatch.setattr(ai_public, "model_factory", lambda resolved: model)
    me = uuid.uuid4()
    enqueue(client, api, "hi", me, uuid.uuid4())
    wait_for(lambda: status_of(db, me) == "done")
    assert pushes.sent == []


def test_no_push_when_notifications_are_denied(
    client: TestClient,
    db: Session,
    monkeypatch: pytest.MonkeyPatch,
    pushes: Pushes,  # noqa: ARG001
) -> None:
    api = chat_user(client, db)
    api.patch("/profile", {"push_permission": "denied"})
    model = GatedModel(script=[say("Here.")], seen=[], opts=[])
    monkeypatch.setattr(ai_public, "model_factory", lambda resolved: model)
    me = uuid.uuid4()
    enqueue(client, api, "hi", me, uuid.uuid4())
    wait_for(lambda: status_of(db, me) == "done")
    assert pushes.sent == []


def _quiet_all_day(db: Session, api: Api) -> None:
    db.add(
        TaskSettings(
            owner_id=uid(api),
            tenant_id=api.user.tenant_id,  # type: ignore[attr-defined]
            quiet_start="00:00",
            quiet_end="23:59",
        )
    )
    db.commit()


def test_quiet_hours_hold_the_push_for_a_message_sent_long_ago(
    client: TestClient,
    db: Session,
    monkeypatch: pytest.MonkeyPatch,
    pushes: Pushes,  # noqa: ARG001
) -> None:
    """A message typed offline hours ago and answered in the night waits in
    the chat; a reply to a message sent just now is pushed (they are up)."""
    api = chat_user(client, db)
    _quiet_all_day(db, api)
    model = GatedModel(script=[say("Old."), say("New.")], seen=[], opts=[])
    monkeypatch.setattr(ai_public, "model_factory", lambda resolved: model)
    monkeypatch.setattr(queue, "kick", lambda owner, delay=0.0: None)
    old, new = uuid.uuid4(), uuid.uuid4()
    thread = uuid.uuid4()
    enqueue(client, api, "old", old, thread)
    row = db.get(CompanionAsk, old)
    assert row is not None
    row.created_at = utcnow() - timedelta(hours=3)
    db.add(row)
    db.commit()
    enqueue(client, api, "new", new, thread)
    queue.drain(uid(api))
    assert [p.body for p in pushes.sent] == ["New."]


def test_a_live_turn_that_dies_after_a_write_is_not_run_again(
    client: TestClient,
    db: Session,
    monkeypatch: pytest.MonkeyPatch,
    pushes: Pushes,  # noqa: ARG001
    no_backoff: None,  # noqa: ARG001
) -> None:
    """The task survives but the turn breaks right after a tool wrote a
    task: retrying could add it twice, so it fails ``interrupted``."""
    api = chat_user(client, db)
    owner = uid(api)
    model = GatedModel(
        script=[
            say("", call("create_tasks", tasks=[{"title": "Buy milk"}])),
            say("Added."),
        ],
        seen=[],
        opts=[],
    )
    monkeypatch.setattr(ai_public, "model_factory", lambda resolved: model)

    def broken(*_a: Any, **_k: Any) -> None:
        raise RuntimeError("died after the write")

    monkeypatch.setattr(queue, "_send_written", broken)
    me = uuid.uuid4()
    r = client.post(
        f"{API}/companion/ask/stream",
        headers=api.h,
        json={"text": "add buy milk", "id": str(me), "thread_id": str(uuid.uuid4())},
    )
    events = parse_agui(r.text)
    assert events[-1]["type"] == "RUN_ERROR"
    assert events[-1]["code"] == "interrupted"
    row = asks(db, owner)[0]
    assert (row.status, row.error, row.attempts, row.wrote) == (
        "failed",
        "interrupted",
        1,
        True,
    )


def test_a_second_claim_waits_while_the_first_holds_the_persons_lock(
    client: TestClient,
    db: Session,
    monkeypatch: pytest.MonkeyPatch,
    pushes: Pushes,  # noqa: ARG001
) -> None:
    """Two drains claim at the same moment (an API task and the worker):
    the second is held at the lock until the first has claimed, then finds
    the turn taken. Without the lock both would claim the same message."""
    api = chat_user(client, db)
    owner = uid(api)
    monkeypatch.setattr(queue, "kick", lambda o, delay=0.0: None)
    me = uuid.uuid4()
    enqueue(client, api, "hello", me, uuid.uuid4())

    real = queue._lock_owner
    first_in, let_go = threading.Event(), threading.Event()
    holder: list[str] = []

    def lock(s: Session, o: uuid.UUID) -> None:
        real(s, o)
        if not holder:
            holder.append(threading.current_thread().name)
            first_in.set()
            assert let_go.wait(10)

    monkeypatch.setattr(queue, "_lock_owner", lock)
    got: dict[str, Any] = {}

    def claim(name: str) -> None:
        got[name] = queue._claim(owner)[0]

    a = threading.Thread(target=claim, args=("a",), name="a")
    a.start()
    assert first_in.wait(10)
    b = threading.Thread(target=claim, args=("b",), name="b")
    b.start()
    b.join(0.5)
    assert b.is_alive(), "the second claim did not wait for the lock"
    let_go.set()
    a.join(10)
    b.join(10)
    assert got["a"] is not None and got["a"].id == me
    assert got["b"] is None
    row = db.get(CompanionAsk, me)
    db.refresh(row)
    assert row is not None and row.attempts == 1


def test_the_sweep_drops_rows_that_ended_long_ago_and_keeps_the_rest(
    client: TestClient,
    db: Session,
    pushes: Pushes,  # noqa: ARG001
) -> None:
    api = chat_user(client, db)
    owner = uid(api)
    tenant = api.user.tenant_id  # type: ignore[attr-defined]
    old = utcnow() - queue.KEEP_ENDED - timedelta(hours=1)
    rows = {
        "old done": ("done", old),
        "old failed": ("failed", old),
        "new done": ("done", utcnow()),
        "old but queued": ("queued", old),
    }
    ids = {}
    for name, (st, at) in rows.items():
        ids[name] = uuid.uuid4()
        db.add(
            CompanionAsk(
                id=ids[name],
                owner_id=owner,
                tenant_id=tenant,
                text=name,
                status=st,
                created_at=at,
                updated_at=at,
                not_before=utcnow() + timedelta(hours=1),
            )
        )
    db.commit()
    queue.prune()
    left = {a.text for a in asks(db, owner)}
    assert left == {"new done", "old but queued"}


def test_a_turn_that_died_after_its_reply_was_stored_is_done_not_failed(
    client: TestClient,
    db: Session,
    pushes: Pushes,  # noqa: ARG001
) -> None:
    """The task died between storing the reply and marking the row done:
    recovery finds the reply and never reports a failure it did not have."""
    from app.shared.ids import derived_id

    api = chat_user(client, db)
    owner = uid(api)
    me, thread = uuid.uuid4(), uuid.uuid4()
    _orphan(db, api, me, thread, wrote=True, store_question=True)
    db.add(
        CompanionMessage(
            id=derived_id("companion-reply", me, "sol"),
            owner_id=owner,
            tenant_id=api.user.tenant_id,  # type: ignore[attr-defined]
            role="sol",
            text="Added buy milk.",
        )
    )
    db.commit()
    queue.drain(owner)
    row = asks(db, owner)[0]
    assert (row.status, row.error) == ("done", None)
