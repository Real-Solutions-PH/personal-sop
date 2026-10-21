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


def test_a_reminder_does_not_hold_back_the_plain_tasks_beside_it(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Seen live on 2026-10-22: one call with a task and a reminder made one
    confirm-tier card, so the plain task waited too. They are two cards now:
    the task saves, the reminder waits."""
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
                    {"title": "Buy milk", "due_date": tomorrow, "due_time": "17:00"},
                    {"title": "Call mom", "due_time": "20:00", "remind": True},
                ],
            ),
        ),
        say("Buy milk is added; the call reminder waits for your OK below."),
    )
    events = stream(api, client, "buy milk tomorrow 5pm, remind me to call mom 8pm")
    assert [t.title for t in tasks_of(api)] == ["Buy milk"]
    step = events[-1]["result"]["messages"][1]["blocks"][0]["items"][0]
    assert [(c["label"], c["state"]) for c in step["cards"]] == [
        ("Buy milk", "saved"),
        ("Call mom", "proposed"),
    ]
    assert (
        step["summary"] == "Added 2 tasks: Buy milk, Call mom (1 waiting for your OK)"
    )


def test_the_model_knows_the_local_time_not_only_the_business_day(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Seen live at 02:53 on 2026-10-22 (before the 04:00 rollover): told only
    "Today is 2026-10-21", the model filed "tonight at 9pm" on the 21st, in
    the past. It now gets the local date and time and the next-time rule."""
    from datetime import datetime
    from zoneinfo import ZoneInfo

    api = user(client, db, accounts=False)
    api.assign("chat")
    model = install(monkeypatch, say("Okay."))
    stream(api, client, "remind me to stretch tonight at 9pm")
    system = str(model.seen[0][0].content)
    now = datetime.now(ZoneInfo("Asia/Manila"))
    assert f"Right now it is {now:%A %Y-%m-%d}" in system
    assert "Their day rolls over at 04:00" in system
    assert "Never schedule something in the past" in system


def test_a_claimed_write_with_no_tool_gets_one_corrective_pass(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Seen live on 2026-10-22: asked to remind, the model answered "has
    been added as a reminder" without calling a tool. The reply is checked
    against the turn's writes; the model is told nothing was saved, once."""
    api = user(client, db, accounts=False)
    api.assign("chat")
    model = install(
        monkeypatch,
        say("Drink water has been added as a reminder for 9 PM."),
        say(
            "",
            call(
                "create_tasks",
                tasks=[{"title": "Drink water", "due_time": "21:00"}],
            ),
        ),
        say("Added: drink water at 9 PM."),
    )
    events = stream(api, client, "add a task to drink water at 9pm")
    assert [t.title for t in tasks_of(api)] == ["Drink water"]
    nudge = str(model.seen[1][-1].content)
    assert "no tool ran" in nudge and '"add a task to drink water at 9pm"' in nudge
    assert "do not repeat them" in nudge
    sol = events[-1]["result"]["messages"][1]
    assert sol["text"] == "Added: drink water at 9 PM."
    assert sol["blocks"][0]["items"][0]["tool"] == "create_tasks"


def test_a_claim_still_unbacked_after_the_retry_is_replaced_by_the_truth(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    api = user(client, db, accounts=False)
    api.assign("chat")
    install(
        monkeypatch,
        say("I've added it to your tasks."),
        say("It's been added and saved."),
    )
    events = stream(api, client, "add a task to buy bread")
    assert tasks_of(api) == []
    assert events[-1]["result"]["messages"][1]["text"] == services.NOT_RECORDED


def test_an_answer_that_only_mentions_logging_is_left_alone(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    """No write was asked for, so "you logged" describing the past is not a
    claim to check, and the model is called once."""
    api = user(client, db, accounts=False)
    api.assign("chat")
    model = install(monkeypatch, say("You logged 3 workouts this week."))
    events = stream(api, client, "how many workouts this week?")
    assert len(model.seen) == 1
    text = events[-1]["result"]["messages"][1]["text"]
    assert text == "You logged 3 workouts this week."
