"""Sol over REST, SSE and sync: the router without a model, the agent's
block tools with a scripted model, the hand-off of logs to capture,
trackers, memories, rename, and the blocks' data endpoints."""

import uuid
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.core.db import engine as db_engine
from app.modules.ai_providers.models import AIUsage
from tests.modules.capture.api.helpers import (
    KEY,
    Api,
    call,
    install,
    parse_sse,
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
        state["name"] == "Sol" and state["trackers"] == [] and state["memories"] == []
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
    assert api.patch("/companion/", {"name": ""})["name"] == "Sol"
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


def test_agent_blocks_and_capture_handoff_stream(
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
            call("log_to_capture", text="ran 5k 32 min"),
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
    frames = parse_sse(r.text)
    events = [e for e, _ in frames]
    assert events[0] == "message" and events[-1] == "done"
    blocks = [d for e, d in frames if e == "block"]
    assert [b["t"] for b in blocks] == ["chart", "tracker"]
    assert "capture" in events and events.count("text.delta") >= 1
    done = frames[-1][1]
    assert done["engine"] == "ai" and done["messages"][1]["blocks"] == blocks
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


@pytest.mark.xfail(
    raises=NotImplementedError,
    strict=False,
    reason="stats.public.series is a stub until stats merges",
)
def test_series_block_data(client: TestClient, db: Session) -> None:
    api = user(client, db)
    out = api.get("/companion/series/spend", days=30)
    assert out["metric"] == "spend" and out["label"] == "Daily spending"
    api.get("/companion/series/bogus", status=422)


@pytest.mark.xfail(
    raises=NotImplementedError,
    strict=False,
    reason="stats.public.overview is a stub until stats merges",
)
def test_insights_block_data(client: TestClient, db: Session) -> None:
    api = user(client, db)
    out = api.get("/companion/insights")
    assert any("on-target streak" in i["title"] for i in out["data"])
