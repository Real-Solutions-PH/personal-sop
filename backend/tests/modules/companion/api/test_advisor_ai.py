"""The finance advisor's AI answer stream: deterministic without a model,
the agent with scope-respecting read tools with one, the disclaimer."""

import json
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session

from tests.modules.capture.api.helpers import (
    KEY,
    Api,
    call,
    install,
    parse_sse,
    say,
    user,
)


def _thread(api: Api) -> str:
    return str(api.post("/finance/advisor/threads", {"title": "Phone"})["id"])


def _ask(api: Api, thread: str, text: str, **extra: Any) -> list[tuple[str, Any]]:
    r = api.c.post(
        f"/api/v1/finance/advisor/threads/{thread}/ask/stream",
        headers=api.h,
        json={"text": text, **extra},
    )
    assert r.status_code == 200, r.text
    api.texts.append(r.text)
    return parse_sse(r.text)


def test_without_a_model_the_deterministic_answer_streams(
    client: TestClient, db: Session
) -> None:
    api = user(client, db)
    th = _thread(api)
    frames = _ask(api, th, "can I afford a 45k laptop in December?")
    events = [e for e, _ in frames]
    assert events == ["message", "answer", "done"]
    answer = frames[1][1]
    assert (
        answer["intent"] == "afford"
        and answer["disclaimer"] == "Not licensed financial advice."
    )
    assert answer["engine"] == "rules"
    detail = api.get(f"/finance/advisor/threads/{th}")
    assert [m["role"] for m in detail["messages"]] == ["user", "ai"]
    assert "₱45,000" in detail["messages"][1]["text"]


def test_unknown_thread_is_a_404_before_the_stream(
    client: TestClient, db: Session
) -> None:
    import uuid

    api = user(client, db)
    r = api.c.post(
        f"/api/v1/finance/advisor/threads/{uuid.uuid4()}/ask/stream",
        headers=api.h,
        json={"text": "hi"},
    )
    assert r.status_code == 404
    other = user(client, db, accounts=False)
    th = _thread(api)
    r = other.c.post(
        f"/api/v1/finance/advisor/threads/{th}/ask/stream",
        headers=other.h,
        json={"text": "hi"},
    )
    assert r.status_code == 404


def test_with_a_model_tools_respect_the_scope(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    api = user(client, db)
    api.assign("advisor")
    th = _thread(api)
    install(
        monkeypatch,
        say("", call("summary"), call("recent_transactions", days=30)),
        say("You can afford it if you wait a month."),
    )
    frames = _ask(api, th, "should I buy a phone?")
    done = frames[-1][1]
    assert done["text"].startswith("You can afford it") and done["text"].endswith(
        "Not licensed financial advice."
    )
    assert done["answer"]["engine"] == "ai" and done["scope"] == "aggregates"
    model_saw = install(
        monkeypatch, say("", call("recent_transactions", days=7)), say("ok")
    )
    _ask(api, th, "where did my money go?", scope="records")
    tool_out = [m for m in model_saw.seen[1] if getattr(m, "type", "") == "tool"][0]
    assert "transactions" in json.loads(tool_out.content)
    first = install(
        monkeypatch, say("", call("recent_transactions", days=7)), say("ok")
    )
    _ask(api, th, "where did my money go?")
    denied = [m for m in first.seen[1] if getattr(m, "type", "") == "tool"][0]
    assert json.loads(denied.content)["error"] == "records_not_shared"
    assert all(KEY not in t for t in api.texts)
