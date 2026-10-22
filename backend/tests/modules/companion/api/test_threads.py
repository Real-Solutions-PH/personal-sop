"""Separate chats with Fern: a new chat starts with a clean context, is
named from its first message, can be renamed and deleted through sync, and
an app that knows no chats keeps talking in the latest one."""

import uuid
from typing import Any

import pytest
from fastapi.testclient import TestClient
from langchain_core.messages import AIMessage, HumanMessage
from sqlmodel import Session

from app.core.config import settings
from tests.modules.capture.api.helpers import Api, install, parse_agui, say, user

SYNC = f"{settings.API_V1_STR}/sync"


def ask(
    api: Api, client: TestClient, text: str, thread: uuid.UUID | None = None
) -> dict[str, Any]:
    body: dict[str, Any] = {"text": text}
    if thread is not None:
        body["thread_id"] = str(thread)
    r = client.post("/api/v1/companion/ask/stream", headers=api.h, json=body)
    assert r.status_code == 200
    out: dict[str, Any] = parse_agui(r.text)[-1]["result"]
    return out


def pull(client: TestClient, api: Api, entity: str) -> dict[str, dict[str, Any]]:
    r = client.get(f"{SYNC}/pull?cursor=0&limit=1000", headers=api.h)
    assert r.status_code == 200, r.text
    return {c["id"]: c for c in r.json()["changes"] if c["entity"] == entity}


def push(client: TestClient, api: Api, *ops: dict[str, Any]) -> list[dict[str, Any]]:
    r = client.post(f"{SYNC}/push", headers=api.h, json={"ops": list(ops)})
    assert r.status_code == 200, r.text
    return list(r.json()["results"])


def test_a_new_chat_starts_clean_and_is_named_from_its_first_message(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    api = user(client, db, accounts=False)
    api.assign("chat")
    first, second = uuid.uuid4(), uuid.uuid4()
    install(monkeypatch, say("Cebu sounds great."))
    out = ask(api, client, "planning a trip to Cebu next month with Ana", first)
    assert out["messages"][0]["thread_id"] == str(first)

    model = install(monkeypatch, say("Here's a plan for today."))
    ask(api, client, "what should I focus on today?", second)
    sent = [
        str(m.content) for m in model.seen[0] if isinstance(m, HumanMessage | AIMessage)
    ]
    # The other chat's words are not in this one's context.
    assert not any("Cebu" in m for m in sent)

    threads = pull(client, api, "companion_thread")
    assert (
        threads[str(first)]["row"]["title"]
        == "planning a trip to Cebu next month with Ana"
    )
    assert threads[str(second)]["row"]["title"] == "what should I focus on today?"

    # Back in the first chat, its history is there again.
    model = install(monkeypatch, say("Ana's coming too."))
    ask(api, client, "who's coming again?", first)
    sent = [
        str(m.content) for m in model.seen[0] if isinstance(m, HumanMessage | AIMessage)
    ]
    assert any("Cebu" in m for m in sent)


def test_a_long_first_message_makes_a_short_title(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    api = user(client, db, accounts=False)
    api.assign("chat")
    t = uuid.uuid4()
    install(monkeypatch, say("Okay."))
    ask(
        api,
        client,
        "add the fixing the bed as a habit and set that as the first habit in the morning routine",
        t,
    )
    title = pull(client, api, "companion_thread")[str(t)]["row"]["title"]
    assert title.endswith("…") and len(title) <= 48
    assert title.startswith("add the fixing the bed as a habit")


def test_without_a_chat_the_latest_one_is_used(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    api = user(client, db, accounts=False)
    api.assign("chat")
    t = uuid.uuid4()
    install(monkeypatch, say("Hi."))
    ask(api, client, "hello there", t)
    install(monkeypatch, say("Still here."))
    out = ask(api, client, "are you there")
    assert {m["thread_id"] for m in out["messages"]} == {str(t)}


def test_rename_and_delete_through_sync(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    api = user(client, db, accounts=False)
    api.assign("chat")
    t = uuid.uuid4()
    install(monkeypatch, say("Noted."))
    out = ask(api, client, "budget for the trip", t)
    ids = [m["id"] for m in out["messages"]]

    renamed = push(
        client,
        api,
        {
            "op_id": str(uuid.uuid4()),
            "kind": "upsert",
            "name": "companion_thread",
            "id": str(t),
            "data": {"title": "Cebu trip"},
        },
    )[0]
    assert renamed["row"]["title"] == "Cebu trip"
    # A chat started on the phone exists before its first message.
    fresh = uuid.uuid4()
    made = push(
        client,
        api,
        {
            "op_id": str(uuid.uuid4()),
            "kind": "upsert",
            "name": "companion_thread",
            "id": str(fresh),
            "data": {},
        },
    )[0]
    assert made["status"] == "applied" and made["row"]["title"] is None

    gone = push(
        client,
        api,
        {
            "op_id": str(uuid.uuid4()),
            "kind": "delete",
            "name": "companion_thread",
            "id": str(t),
            "data": {},
        },
    )[0]
    assert gone["status"] == "applied", gone
    messages = pull(client, api, "companion_message")
    assert all(messages[i]["deleted"] is True for i in ids)
    assert pull(client, api, "companion_thread")[str(t)]["deleted"] is True
