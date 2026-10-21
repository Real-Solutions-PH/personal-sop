"""Fern as one multi-step agent (ADR-0015): a request to add something
reaches the write tool in the same run, every step streams as an AG-UI
event, and a reply that only answers writes nothing.

The model is substituted only at ``ai_providers.public.model_factory`` (the
scripted model in the capture helpers)."""

from datetime import date, timedelta
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.core.db import engine as db_engine
from app.modules.capture.models import Capture
from app.modules.companion import services
from app.modules.tasks.models import Task
from tests.modules.capture.api.helpers import (
    Api,
    call,
    install,
    parse_agui,
    say,
    user,
)


def stream(api: Api, client: TestClient, text: str) -> list[dict[str, Any]]:
    r = client.post("/api/v1/companion/ask/stream", headers=api.h, json={"text": text})
    assert r.status_code == 200
    return parse_agui(r.text)


def tasks_of(api: Api) -> list[Task]:
    with Session(db_engine) as s:
        return list(
            s.exec(select(Task).where(Task.owner_id == api.user.id)).all()  # type: ignore[attr-defined]
        )


def captures_of(api: Api) -> list[Capture]:
    with Session(db_engine) as s:
        return list(
            s.exec(select(Capture).where(Capture.owner_id == api.user.id)).all()  # type: ignore[attr-defined]
        )


def test_a_task_request_creates_the_task_in_the_same_run(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    api = user(client, db, accounts=False)
    api.assign("chat")
    tomorrow = (date.today() + timedelta(days=1)).isoformat()
    install(
        monkeypatch,
        say(
            "",
            call(
                "create_tasks",
                tasks=[
                    {"title": "Buy milk", "due_date": tomorrow, "due_time": "17:00"}
                ],
            ),
        ),
        say("Added it: buy milk tomorrow at 5 PM."),
    )
    events = stream(api, client, "add a task to buy milk tomorrow at 5pm")

    made = tasks_of(api)
    assert [(t.title, str(t.due_date), t.due_time) for t in made] == [
        ("Buy milk", tomorrow, "17:00")
    ]
    result = next(e for e in events if e["type"] == "TOOL_CALL_RESULT")
    assert '"summary": "Added task: Buy milk' in result["content"]
    assert f"{tomorrow} 17:00" in result["content"]
    done = events[-1]["result"]
    steps = done["messages"][1]["blocks"][0]
    assert steps["t"] == "steps"
    assert steps["items"][0]["tool"] == "create_tasks" and steps["items"][0]["ok"]
    caps = captures_of(api)
    assert [(c.source, c.status) for c in caps] == [("chat", "done")]
    assert done["capture"]["id"] == str(caps[0].id)


def test_steps_stream_in_order_across_several_model_calls(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Look something up, act on it, then answer: three model calls, each a
    step, with the tool steps between them and the text last."""
    api = user(client, db, accounts=False)
    api.assign("chat")
    install(
        monkeypatch,
        say("", call("stats_overview", days=7)),
        say("", call("create_tasks", tasks=[{"title": "Walk 20 min"}])),
        say("Your week is light on training, so I added a walk."),
    )
    events = stream(api, client, "how's my week? add something to help")
    seq = [
        (e["type"], e.get("stepName") or e.get("toolCallName") or e.get("name"))
        for e in events
        if e["type"]
        in (
            "RUN_STARTED",
            "STEP_STARTED",
            "STEP_FINISHED",
            "TOOL_CALL_START",
            "TEXT_MESSAGE_START",
            "RUN_FINISHED",
        )
    ]
    assert seq == [
        ("RUN_STARTED", None),
        ("STEP_STARTED", "think:1"),
        ("STEP_FINISHED", "think:1"),
        ("STEP_STARTED", "tool:stats_overview"),
        ("TOOL_CALL_START", "stats_overview"),
        ("STEP_FINISHED", "tool:stats_overview"),
        ("STEP_STARTED", "think:2"),
        ("STEP_FINISHED", "think:2"),
        ("STEP_STARTED", "tool:create_tasks"),
        ("TOOL_CALL_START", "create_tasks"),
        ("STEP_FINISHED", "tool:create_tasks"),
        ("STEP_STARTED", "think:3"),
        ("TEXT_MESSAGE_START", None),
        ("STEP_FINISHED", "think:3"),
        ("RUN_FINISHED", None),
    ]
    assert [t.title for t in tasks_of(api)] == ["Walk 20 min"]


def test_a_reply_that_only_answers_writes_no_capture(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    api = user(client, db, accounts=False)
    api.assign("chat")
    install(monkeypatch, say("", call("plan_day")), say("Nothing is due today."))
    events = stream(api, client, "what's on today?")
    done = events[-1]["result"]
    assert done["capture"] is None
    assert captures_of(api) == [] and tasks_of(api) == []
    assert done["messages"][1]["blocks"][0]["items"][0]["summary"] == (
        "Planned your day"
    )


def test_a_write_waiting_for_the_user_says_so(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A reminder is a confirm-tier card: it waits, and the step says so."""
    api = user(client, db, accounts=False)
    api.assign("chat")
    install(
        monkeypatch,
        say(
            "",
            call(
                "create_tasks",
                tasks=[{"title": "Call mom", "due_time": "19:00", "remind": True}],
            ),
        ),
        say("I set it up; confirm it in the card."),
    )
    events = stream(api, client, "remind me to call mom at 7pm")
    step = events[-1]["result"]["messages"][1]["blocks"][0]["items"][0]
    assert step["state"] == "proposed" and step["summary"].endswith(
        "(waiting for your OK)"
    )
    assert tasks_of(api) == []


def test_tool_calls_past_the_reply_cap_are_refused(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    api = user(client, db, accounts=False)
    api.assign("chat")
    monkeypatch.setattr(services, "MAX_TOOL_CALLS", 2)
    install(
        monkeypatch,
        say("", call("create_tasks", tasks=[{"title": "One"}])),
        say("", call("create_tasks", tasks=[{"title": "Two"}])),
        say("", call("create_tasks", tasks=[{"title": "Three"}])),
        say("Done."),
    )
    events = stream(api, client, "add three tasks one at a time")
    items = events[-1]["result"]["messages"][1]["blocks"][0]["items"]
    assert [i["ok"] for i in items] == [True, True, False]
    assert sorted(t.title for t in tasks_of(api)) == ["One", "Two"]
