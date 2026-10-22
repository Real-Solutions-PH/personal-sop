"""The companion over REST, SSE and sync: the router without a model, the agent's
block tools with a scripted model, the hand-off of logs to capture,
trackers, memories, rename, and the blocks' data endpoints."""

import uuid
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.core.db import engine as db_engine
from app.modules.ai_providers.models import AIUsage
from app.modules.companion.defaults import COMPANION_NAME
from tests.modules.capture.api.helpers import (
    KEY,
    Api,
    call,
    install,
    parse_agui,
    say,
    user,
)


def ask(api: Api, text: str, **extra: Any) -> dict[str, Any]:
    return dict(api.post("/companion/ask", {"text": text, **extra}))


def test_router_replies_and_records_trackers_and_memories(
    client: TestClient, db: Session
) -> None:
    api = user(client, db)
    api.patch(
        "/profile/", {"name": "Kai Tecson"}, status=None
    )  # best effort: profile name
    state = api.get("/companion/")
    assert (
        state["name"] == COMPANION_NAME
        and state["trackers"] == []
        and state["memories"] == []
    )
    hi = ask(api, "hi")
    assert hi["kind"] == "reply" and hi["engine"] == "rules"
    me, sol = hi["messages"]
    assert (me["role"], sol["role"]) == ("me", "sol")
    assert sol["blocks"][0]["t"] == "chips"
    t = ask(api, "track my spending under 1,500")
    block = t["messages"][1]["blocks"][0]
    trackers = api.get("/companion/")["trackers"]
    assert block == {"t": "tracker", "id": trackers[0]["id"]}
    assert (trackers[0]["metric"], trackers[0]["goal"], trackers[0]["direction"]) == (
        "spend",
        1500,
        "below",
    )
    # a second tracker on the same metric updates it
    ask(api, "track spending above 2000")
    again = api.get("/companion/")["trackers"]
    assert len(again) == 1 and (again[0]["goal"], again[0]["direction"]) == (
        2000,
        "above",
    )
    ask(api, "remember that I'm training for a 10K.")
    mems = api.get("/companion/")["memories"]
    assert [m["text"] for m in mems] == ["I'm training for a 10K."]
    api.delete(f"/companion/memories/{mems[0]['id']}")
    assert api.get("/companion/")["memories"] == []
    chart = ask(api, "show my weight over 90 days")["messages"][1]["blocks"][0]
    assert chart == {"t": "chart", "metric": "weight", "days": 90}
    # a replayed message id answers once
    mid = str(uuid.uuid4())
    first = ask(api, "coach me", id=mid)
    second = ask(api, "coach me", id=mid)
    assert [m["id"] for m in second["messages"]] == [m["id"] for m in first["messages"]]
    assert api.get("/companion/messages")["count"] == 12


def test_a_log_becomes_a_capture(client: TestClient, db: Session) -> None:
    api = user(client, db)
    out = ask(api, "spent 250 on grab")
    assert out["kind"] == "capture" and out["messages"] == []
    cap = out["capture"]
    assert cap["source"] == "text" and cap["cards"][0]["state"] == "saved"
    assert api.get("/companion/messages")["count"] == 0
    assert api.get("/capture/")["count"] == 1


def test_crud_rename_clear_and_validation(client: TestClient, db: Session) -> None:
    api = user(client, db)
    assert api.patch("/companion/", {"name": "  Luz "})["name"] == "Luz"
    assert ask(api, "who are you")["messages"][1]["text"].startswith("I'm Luz,")
    assert api.patch("/companion/", {"name": ""})["name"] == COMPANION_NAME
    tr = api.put("/companion/trackers/weight", {"goal": 70, "direction": "below"})
    assert tr["label"] == "Weight"
    api.put("/companion/trackers/bogus", {}, status=422)
    api.delete(f"/companion/trackers/{tr['id']}")
    api.delete(f"/companion/trackers/{tr['id']}", status=404)
    m = api.post("/companion/memories", {"text": "Likes early runs"}, status=201)
    api.post("/companion/memories", {"text": ""}, status=422)
    ask(api, "hello")
    assert api.delete("/companion/messages", status=200)["message"].startswith(
        "Cleared 4"
    )
    assert api.get("/companion/messages")["count"] == 0
    other = user(client, db, accounts=False)
    other.delete(f"/companion/memories/{m['id']}", status=404)
    assert other.get("/companion/")["memories"] == []
    api.post("/companion/ask", {"text": ""}, status=422)


def test_agent_blocks_and_a_write_stream_as_ag_ui(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    api = user(client, db)
    api.assign("chat")
    api.post("/companion/memories", {"text": "Training for a 10K"}, status=201)
    model = install(
        monkeypatch,
        say(
            "",
            call("show_chart", metric="workouts", days=30),
            call("track", metric="workouts", goal=4, direction="above"),
            {
                "name": "log_workout",
                "args": {
                    "name": "5K run",
                    "cardio": {"activity": "Run", "km": 5, "minutes": 32},
                },
                "id": "call-workout",
            },
        ),
        say("Nice run. Here's your month and I'll watch your sessions."),
    )
    r = client.post(
        "/api/v1/companion/ask/stream",
        headers=api.h,
        json={"text": "ran 5k today, how's my training?"},
    )
    assert r.status_code == 200 and r.headers["content-type"].startswith(
        "text/event-stream"
    )
    events = parse_agui(r.text)
    types = [e["type"] for e in events]
    assert types[0] == "RUN_STARTED" and types[-1] == "RUN_FINISHED"
    custom = [(e["name"], e["value"]) for e in events if e["type"] == "CUSTOM"]
    assert custom[0][0] == "message"
    blocks = [v for n, v in custom if n == "block"]
    assert [b["t"] for b in blocks] == ["chart", "tracker"]
    cards = [v for n, v in custom if n == "card"]
    assert [c["kind"] for c in cards] == ["workout"]
    assert types.count("TOOL_CALL_START") == 3 and "TEXT_MESSAGE_CONTENT" in types
    done = events[-1]["result"]
    stored = done["messages"][1]["blocks"]
    assert stored[0]["t"] == "steps" and stored[1:] == blocks
    assert [i["tool"] for i in stored[0]["items"]] == [
        "show_chart",
        "track",
        "log_workout",
    ]
    assert done["engine"] == "ai" and done["capture"]["source"] == "chat"
    assert done["capture"]["cards"][0]["kind"] == "workout"
    # memories and trackers are in the model's context
    system = model.seen[0][0].content
    assert "Training for a 10K" in system
    with Session(db_engine) as s:
        purposes = [
            u.purpose
            for u in s.exec(
                select(AIUsage).where(AIUsage.owner_id == api.user.id)
            ).all()
        ]  # type: ignore[attr-defined]
    assert purposes == ["chat", "chat"]
    assert KEY not in r.text


def test_agent_failure_falls_back_to_the_router(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    api = user(client, db)
    api.assign("chat")
    install(monkeypatch, fail=True)
    out = ask(api, "plan my day")
    assert out["engine"] == "rules" and out["messages"][1]["blocks"] == [{"t": "plan"}]
    assert all(KEY not in t and "exploded" not in t for t in api.texts)


def test_sync_entities(client: TestClient, db: Session) -> None:
    from tests.modules.capture.api.test_sync_journal_queue import op, pull, push

    api = user(client, db)
    rename = op("upsert", "companion", uuid.uuid4())
    rename["data"] = {"name": "Nova"}
    [c] = push(api, rename)
    assert c["row"]["name"] == "Nova"
    tid = uuid.uuid4()
    [t] = push(api, op("upsert", "tracker", tid, metric="tasks"))
    assert t["row"]["label"] == "Tasks done"
    [t2] = push(api, op("upsert", "tracker", tid, goal=5, direction="above"))
    assert t2["row"]["goal"] == 5
    [missing] = push(api, op("upsert", "tracker", uuid.uuid4(), goal=3))
    assert missing["code"] == "missing_fields"
    [m] = push(api, op("upsert", "memory", uuid.uuid4(), text="Vegetarian on Fridays"))
    assert m["status"] == "applied"
    [ro] = push(api, op("upsert", "companion_message", uuid.uuid4(), text="hi"))
    assert ro["code"] == "unknown_entity"
    ask(api, "hi")
    got = pull(api)
    assert {"companion", "tracker", "memory", "companion_message"} <= set(got)
    [d] = push(api, op("delete", "tracker", tid))
    assert d["status"] == "applied"


def test_series_block_data(client: TestClient, db: Session) -> None:
    api = user(client, db)
    out = api.get("/companion/series/spend", days=30)
    assert out["metric"] == "spend" and out["label"] == "Daily spending"
    api.get("/companion/series/bogus", status=422)


def test_insights_block_data(client: TestClient, db: Session) -> None:
    api = user(client, db)
    out = api.get("/companion/insights")
    assert any("on-target streak" in i["title"] for i in out["data"])


def test_a_failed_model_hands_a_log_to_capture_with_the_question_stored_once(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    from tests.modules.capture.api.test_sync_journal_queue import pull

    api = user(client, db)
    api.assign("chat")
    install(monkeypatch, fail=True)
    me_id = uuid.uuid4()
    out = ask(api, "spent 250 on grab", id=str(me_id))
    assert out["kind"] == "capture" and out["capture"]["text"] == "spent 250 on grab"
    # the capture carries the question in the thread; no companion copy of it
    msgs = api.get("/companion/messages")["data"]
    assert [m for m in msgs if m["text"] == "spent 250 on grab"] == []
    # the copy the AI path streamed before its provider failed is tombstoned,
    # so a device that received it drops it on the next pull
    changes = [
        c for c in pull(api).get("companion_message", []) if c["id"] == str(me_id)
    ]
    assert changes and all(c["deleted"] for c in changes)


def test_nutrition_status_shows_the_day_as_one_card(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    api = user(client, db)
    api.assign("chat")
    install(
        monkeypatch,
        say("", call("nutrition_status")),
        # Asked twice in one reply: still one card.
        say("", call("nutrition_status")),
        say("1,470 kcal and 90 g protein left today."),
    )
    r = client.post(
        "/api/v1/companion/ask/stream",
        headers=api.h,
        json={"text": "how are my macros today?"},
    )
    events = parse_agui(r.text)
    custom = [(e["name"], e["value"]) for e in events if e["type"] == "CUSTOM"]
    blocks = [v for n, v in custom if n == "block"]
    assert len(blocks) == 1 and blocks[0]["t"] == "nutrition"
    stored = events[-1]["result"]["messages"][1]["blocks"]
    assert stored[1:] == blocks
    # The card names its business day, so an old reply keeps its own day.
    assert len(blocks[0]["day"]) == 10 and blocks[0]["day"][4] == "-"


def test_a_macros_question_answered_without_the_tool_still_shows_the_card(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    api = user(client, db)
    api.assign("chat")
    install(monkeypatch, say("You have 1,470 kcal left today."))
    r = client.post(
        "/api/v1/companion/ask/stream",
        headers=api.h,
        json={"text": "can you pull up my macros?"},
    )
    events = parse_agui(r.text)
    blocks = [e["value"] for e in events if e.get("name") == "block"]
    assert [b["t"] for b in blocks] == ["nutrition"]


def test_a_question_about_something_else_shows_no_nutrition_card(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    api = user(client, db)
    api.assign("chat")
    install(monkeypatch, say("Three tasks are left today."))
    r = client.post(
        "/api/v1/companion/ask/stream",
        headers=api.h,
        json={"text": "what's left on my tasks today?"},
    )
    events = parse_agui(r.text)
    assert not [e for e in events if e.get("name") == "block"]
