"""Captures read by the user's own model (a scripted fake installed through
``ai_providers.public.model_factory``): tool calls become tiered cards,
the reply streams as SSE, every call is metered, refusals happen before
the stream opens, and the API key never appears anywhere."""

import uuid

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.core.db import engine as db_engine
from app.modules.ai_providers.models import AIUsage
from tests.modules.capture.api.helpers import KEY, call, card_of, install, say, user


def _usage(api: object) -> list[AIUsage]:
    with Session(db_engine) as s:
        return list(s.exec(select(AIUsage).where(AIUsage.owner_id == api.user.id)).all())  # type: ignore[attr-defined]


def test_stream_frames_cards_and_metering(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    api = user(client, db)
    api.assign("capture")
    model = install(
        monkeypatch,
        say(
            "",
            call("log_expense", amount=250, category="grab", payee="Grab"),
            call("create_tasks", tasks=[{"title": "Pay rent", "due_date": "2026-10-30", "remind": True}]),
        ),
        say("Logged your ride and the rent reminder."),
    )
    _, frames, raw = api.stream("spent 250 on grab, remind me to pay rent on the 30th")
    events = [e for e, _ in frames]
    assert events[0] == "capture" and events[-1] == "done"
    assert events.count("card") == 2
    assert events.index("card") < events.index("text.delta")
    deltas = "".join(d["text"] for e, d in frames if e == "text.delta")
    assert deltas == "Logged your ride and the rent reminder."
    done = frames[-1][1]
    assert done["engine"] == "ai" and done["reply_text"] == deltas
    exp, task = card_of(done, "expense"), card_of(done, "task")
    assert (exp["state"], exp["payload"]["amount_minor"]) == ("saved", 25000)
    assert (task["tier"], task["state"]) == ("confirm", "proposed")  # reminders confirm
    # two model calls, both metered with their tokens and a cost estimate
    rows = _usage(api)
    assert len(rows) == 2 and all(r.purpose == "capture" and r.ok for r in rows)
    assert all(r.input_tokens == 120 and r.output_tokens == 30 and r.cost_minor > 0 for r in rows)
    assert len(model.seen) == 2
    assert KEY not in raw and all(KEY not in t for t in api.texts)


def test_lookup_tool_answers_with_a_card_and_asks_stream_an_ask_frame(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    api = user(client, db)
    api.assign("capture")
    install(
        monkeypatch,
        say("", call("lookup", question="how much did I spend this week?"), call("log_expense", amount=1500)),
        say("Here you go."),
    )
    _, frames, _ = api.stream("how much this week? also paid 1500")
    kinds = [(e, d.get("kind")) for e, d in frames if e in ("card", "ask")]
    assert ("card", "answer") in kinds and ("ask", None) in kinds
    done = frames[-1][1]
    assert done["status"] == "needs_input"


def test_refused_before_the_stream_opens_when_disabled_or_over_cap(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    api = user(client, db)
    api.assign("capture")
    model = install(monkeypatch)
    api.patch("/capture/settings", {"ai_enabled": False})
    code, _, raw = api.stream("spent 100 on coffee", status=403)
    assert code == 403 and '"ai_disabled"' in raw and "text/event-stream" not in raw
    api.patch("/capture/settings", {"ai_enabled": True, "spend_cap_minor": 0})
    _, _, raw = api.stream("spent 100 on coffee", status=402)
    assert '"ai_spend_cap_reached"' in raw
    # the input is kept as a failed capture with its error card; no model call
    caps = api._go("GET", "/capture/", 200, params={"status": "failed"})["data"]
    assert len(caps) == 2 and all(c["replies"][0]["body"]["tone"] == "error" for c in caps)
    assert model.seen == []
    # the plain endpoint refuses the same way
    api.capture("spent 100 on coffee", status=402)


def test_provider_failure_falls_back_to_the_rules_and_never_leaks(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    api = user(client, db)
    api.assign("capture")
    install(monkeypatch, fail=True)
    _, frames, raw = api.stream("spent 250 on grab")
    done = frames[-1][1]
    assert done["engine"] == "rules" and card_of(done, "expense")["state"] == "saved"
    assert any(e == "info" and "didn't answer" in d["body"]["title"] for e, d in frames)
    assert KEY not in raw and "exploded" not in raw
    rows = _usage(api)
    assert len(rows) == 1 and rows[0].ok is False


def test_invalid_input_is_a_422_not_a_stream(client: TestClient, db: Session) -> None:
    api = user(client, db)
    api.stream("", status=422)
    api.stream("x", source="photo", status=422)
    api.stream("hi", at="2026-10-18T10:00:00", status=422)  # naive time


def test_no_model_streams_the_rules_reading(client: TestClient, db: Session) -> None:
    api = user(client, db)
    _, frames, _ = api.stream("spent 250 on grab")
    events = [e for e, _ in frames]
    assert events == ["capture", "card", "info", "done"]
    assert frames[2][1]["body"]["tone"] == "fallback"


def test_replayed_stream_returns_the_stored_capture(client: TestClient, db: Session) -> None:
    api = user(client, db)
    cu = str(uuid.uuid4())
    r1 = client.post("/api/v1/capture/stream", headers=api.h, json={"client_uuid": cu, "text": "spent 90 on coffee"})
    r2 = client.post("/api/v1/capture/stream", headers=api.h, json={"client_uuid": cu, "text": "spent 90 on coffee"})
    from tests.modules.capture.api.helpers import parse_sse

    f1, f2 = parse_sse(r1.text), parse_sse(r2.text)
    assert [e for e, _ in f2] == ["capture", "done"]
    assert f2[-1][1]["id"] == f1[-1][1]["id"]
    assert len(api.get("/capture/")["data"]) == 1
