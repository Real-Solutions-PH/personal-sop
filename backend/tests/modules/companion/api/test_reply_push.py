"""'Fern replied' push: when a streamed reply finishes and the person has no
live event stream (the app is in the background or closed), each of their
devices gets a push with a short preview that opens the chat. A person
watching the chat gets none. The reply finishes, is stored and pushed even
when the phone drops the stream half way."""

import json
import threading
import time
import uuid
from collections.abc import MutableMapping
from dataclasses import dataclass, field
from typing import Any

import anyio
import pytest
from fastapi.testclient import TestClient
from langchain_core.messages import AIMessage, BaseMessage
from sqlmodel import Session, col, select

from app.core.config import settings
from app.modules.ai_providers import public as ai_public
from app.modules.companion import services
from app.modules.companion.models import CompanionMessage
from app.modules.realtime import presence
from app.shared import push
from tests.modules.capture.api.helpers import (
    Api,
    ScriptedModel,
    install,
    parse_agui,
    say,
    user,
)

STREAM = f"{settings.API_V1_STR}/companion/ask/stream"
TOKEN = "ExponentPushToken[fern-reply-test]"


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


def chat_user(client: TestClient, db: Session) -> Api:
    api = user(client, db, accounts=False)
    api.assign("chat")
    api.post("/profile/push-devices", {"token": TOKEN, "platform": "ios"})
    return api


def ask(client: TestClient, api: Api, text: str, thread: uuid.UUID) -> list[Any]:
    r = client.post(
        STREAM, headers=api.h, json={"text": text, "thread_id": str(thread)}
    )
    assert r.status_code == 200, r.text
    return parse_agui(r.text)


def test_a_reply_finished_while_the_app_is_away_is_pushed_with_a_preview(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch, pushes: Pushes
) -> None:
    api = chat_user(client, db)
    thread = uuid.uuid4()
    install(
        monkeypatch,
        say(
            "**Good news:** you're under budget this week by ₱1,200. "
            "Keep the same lunch plan and you'll close the month well ahead "
            "of where you were in September, with room for the Cebu trip."
        ),
    )
    ask(client, api, "how's my spending?", thread)

    assert [m.token for m in pushes.sent] == [TOKEN]
    sent = pushes.sent[0]
    assert sent.title == "Fern replied"
    # Plain words, cut short at a word boundary.
    assert sent.body.startswith("Good news: you're under budget this week")
    assert "**" not in sent.body
    assert len(sent.body) <= 120
    assert sent.body.endswith("…")
    # The tap opens this chat.
    assert sent.data["href"] == f"/capture?thread={thread}"
    assert sent.data["thread_id"] == str(thread)
    assert sent.data["kind"] == "companion.reply"
    # A newer reply in the same chat replaces the older banner.
    assert sent.thread == f"companion:{thread}"


def test_a_short_reply_is_pushed_whole_under_the_companions_name(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch, pushes: Pushes
) -> None:
    api = chat_user(client, db)
    api.patch("/companion/", {"name": "Moss"})
    install(monkeypatch, say("Done, see you tomorrow."))
    ask(client, api, "remind me later", uuid.uuid4())
    assert [(m.title, m.body) for m in pushes.sent] == [
        ("Moss replied", "Done, see you tomorrow.")
    ]


def test_no_push_while_the_person_is_in_the_app(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch, pushes: Pushes
) -> None:
    api = chat_user(client, db)
    pushes.live.add(api.user.id)  # type: ignore[attr-defined]
    install(monkeypatch, say("Here's your plan."))
    events = ask(client, api, "plan my day", uuid.uuid4())
    assert events[-1]["type"] == "RUN_FINISHED"
    assert pushes.sent == []


def test_a_failed_reply_is_not_pushed(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch, pushes: Pushes
) -> None:
    api = chat_user(client, db)

    def boom(*_a: Any, **_k: Any) -> None:
        raise RuntimeError("the turn broke")

    monkeypatch.setattr(services, "ask", boom)
    events = ask(client, api, "plan my day", uuid.uuid4())
    assert events[-1]["type"] == "RUN_ERROR"
    assert pushes.sent == []


class HeldModel(ScriptedModel):
    """Waits for ``release`` before answering, so the test can drop the
    stream while the reply is still being written."""

    release: Any = None

    def _next(self, messages: list[BaseMessage]) -> AIMessage:
        assert self.release.wait(20), "the test never released the model"
        return super()._next(messages)


def test_the_reply_finishes_and_is_pushed_after_the_phone_drops_the_stream(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch, pushes: Pushes
) -> None:
    """Drives the app over raw ASGI: the phone reads the first frame, then
    its connection goes (the app went to the background). ``send`` raising
    ``OSError`` is how the server sees a closed connection (ASGI 2.4)."""
    api = chat_user(client, db)
    thread, me = uuid.uuid4(), uuid.uuid4()
    release = threading.Event()
    model = HeldModel(script=[say("All set for tomorrow.")], seen=[], release=release)
    monkeypatch.setattr(ai_public, "model_factory", lambda resolved: model)

    body = json.dumps(
        {"text": "set me up for tomorrow", "id": str(me), "thread_id": str(thread)}
    ).encode()
    frames: list[bytes] = []

    async def drive() -> None:
        sent_body = False

        async def receive() -> dict[str, Any]:
            nonlocal sent_body
            if not sent_body:
                sent_body = True
                return {"type": "http.request", "body": body, "more_body": False}
            await anyio.sleep_forever()
            raise AssertionError  # pragma: no cover

        async def send(message: MutableMapping[str, Any]) -> None:
            if message["type"] == "http.response.body" and message.get("body"):
                if frames:
                    raise OSError("connection closed by the phone")
                frames.append(message["body"])

        scope = {
            "type": "http",
            "asgi": {"version": "3.0", "spec_version": "2.4"},
            "http_version": "1.1",
            "method": "POST",
            "scheme": "http",
            "path": STREAM,
            "raw_path": STREAM.encode(),
            "query_string": b"",
            "root_path": "",
            "headers": [
                (b"host", b"testserver"),
                (b"content-type", b"application/json"),
                (b"content-length", str(len(body)).encode()),
                *[(k.lower().encode(), v.encode()) for k, v in api.h.items()],
            ],
            "client": ("127.0.0.1", 50000),
            "server": ("testserver", 80),
            "state": {},
        }
        with anyio.fail_after(20):
            try:
                await client.app(scope, receive, send)
            except Exception:  # noqa: BLE001 - the dropped connection surfaces here
                pass

    # The phone is gone before the model has said a word.
    threading.Timer(0.5, release.set).start()
    anyio.run(drive)
    assert frames, "the stream never opened"

    stored: list[CompanionMessage] = []
    deadline = time.monotonic() + 20
    while time.monotonic() < deadline:
        db.expire_all()
        stored = list(
            db.exec(
                select(CompanionMessage).where(
                    col(CompanionMessage.thread_id) == thread,
                    CompanionMessage.role == "sol",
                )
            ).all()
        )
        if stored and pushes.sent:
            break
        time.sleep(0.2)
    assert [m.text for m in stored] == ["All set for tomorrow."]
    assert [(m.body, m.data["thread_id"]) for m in pushes.sent] == [
        ("All set for tomorrow.", str(thread))
    ]
