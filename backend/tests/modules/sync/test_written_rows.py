"""What Fern records, or a card decision writes, reaches the phone with the
answer itself, even while the pull holds it back.

Seen live 2026-11-03: a record Fern saved, or a card confirmed in the chat,
showed only after a refresh. A pull hands out only rows committed before
every transaction still running began, and Fern keeps one open for its
whole turn and again while it learns from the reply; the pull that followed
the write came back empty and nothing asked for another. So the finished
reply and the pushed decision carry the rows they wrote, and a pull says
when it is holding committed rows back (``held``) so the phone asks again.
"""

import json
import os
import re
import uuid
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text
from sqlmodel import Session

from app.core.db import engine
from app.shared.ids import derived_id
from tests.modules.capture.api.helpers import (
    API,
    Api,
    call,
    install,
    parse_agui,
    say,
    user,
)
from tests.modules.companion.api.meal_items import full


@contextmanager
def slow_writer() -> Iterator[None]:
    """A transaction holding a transaction id, as a Fern turn (or the
    learning after its reply) does while it waits on the model."""
    with engine.connect() as slow:
        tx = slow.begin()
        slow.execute(text("SELECT pg_current_xact_id()"))
        try:
            yield
        finally:
            tx.rollback()


def finished(api: Api, client: TestClient, words: str) -> dict[str, Any]:
    r = client.post(f"{API}/companion/ask/stream", headers=api.h, json={"text": words})
    assert r.status_code == 200, r.text
    done = [e for e in parse_agui(r.text) if e.get("type") == "RUN_FINISHED"]
    assert done, r.text
    return dict(done[-1]["result"])


def act(api: Api, client: TestClient, name: str, **data: Any) -> dict[str, Any]:
    op = {"op_id": str(uuid.uuid4()), "kind": "action", "name": name, "data": data}
    r = client.post(f"{API}/sync/push", headers=api.h, json={"ops": [op]})
    assert r.status_code == 200, r.text
    (res,) = r.json()["results"]
    assert res["status"] == "applied", res
    return dict(res)


def rows(changes: list[dict[str, Any]], entity: str) -> list[dict[str, Any]]:
    return [c for c in changes if c["entity"] == entity]


def pull(api: Api, client: TestClient, cursor: int) -> dict[str, Any]:
    r = client.get(f"{API}/sync/pull?cursor={cursor}", headers=api.h)
    assert r.status_code == 200, r.text
    return dict(r.json())


MEAL = {
    "description": "Lunch: rice and adobo",
    "items": [
        full({"name": "Rice", "kcal": 200, "carbs": 50, "grams": 150}),
        full({"name": "Adobo", "kcal": 160, "carbs": 40, "grams": 120}),
    ],
    "confidence": 0.8,
}

# (record type, what Fern is told, its tool call, the synced entity it writes)
CASES = [
    (
        "transaction",
        "250 grab",
        call("log_expense", amount=250, category="grab", payee="Grab"),
        "fin_record",
    ),
    ("meal", "lunch was rice and adobo", call("log_meal", **MEAL), "meal"),
    (
        "workout",
        "did bench 3x8 at 60",
        {
            "name": "log_workout",
            "args": {
                "name": "Push",
                "exercises": [
                    {"exercise": "Bench Press", "sets": [{"reps": 8, "weight": 60}] * 3}
                ],
            },
            "id": "call-workout",
        },
        "workout",
    ),
    ("habit", "stretched today", call("log_habit", habit="Stretch"), "habit_log"),
    (
        "task",
        "remind me to buy milk",
        call("create_tasks", tasks=[{"title": "Buy milk"}]),
        "task",
    ),
    ("weight", "62.4 kg today", call("log_weigh_in", kg=62.4), "weigh_in"),
    (
        "journal",
        "journal: a calm day at the beach",
        call("save_journal", body="A calm day at the beach."),
        "journal_entry",
    ),
]


@pytest.mark.parametrize(
    ("kind", "words", "tool", "entity"), CASES, ids=[c[0] for c in CASES]
)
def test_a_record_fern_writes_comes_back_with_the_reply_and_its_decisions(
    client: TestClient,
    db: Session,
    monkeypatch: pytest.MonkeyPatch,
    kind: str,
    words: str,
    tool: dict[str, Any],
    entity: str,
) -> None:
    api = user(client, db)
    api.assign("chat")
    if kind == "habit":
        api.post("/habits/", {"name": "Stretch"})
    cursor = pull(api, client, 0)["cursor"]
    install(monkeypatch, say("", tool), say("Done."))

    out = finished(api, client, words)
    (card,) = rows(out["changes"], "record_card")
    if card["row"]["state"] == "proposed":
        assert rows(out["changes"], entity) == []
        # Confirmed while another turn's transaction holds the pull back.
        with slow_writer():
            confirmed = act(api, client, "capture.confirm", card_id=card["id"])
            held = pull(api, client, cursor)
            assert rows(held["changes"], entity) == []
            assert held["held"] is True
        saved = rows(confirmed["changes"], entity)
    else:
        saved = rows(out["changes"], entity)
    assert saved and not saved[0]["deleted"], out["changes"]
    record_id = saved[0]["id"]

    with slow_writer():
        undone = act(api, client, "capture.undo", card_id=card["id"])
    (gone,) = [c for c in undone["changes"] if c["id"] == record_id]
    assert (
        gone["deleted"]
        or gone["row"].get("deleted_at")
        or gone["row"].get("status") in ("deleted", "undone")
    ), gone
    (after,) = rows(undone["changes"], "record_card")
    assert after["row"]["state"] == "undone"

    # The pull still brings everything once nothing older is running.
    settled = pull(api, client, cursor)
    assert settled["held"] is False
    assert any(c["id"] == record_id for c in settled["changes"])


def stream(api: Api, client: TestClient, words: str) -> list[dict[str, Any]]:
    r = client.post(f"{API}/companion/ask/stream", headers=api.h, json={"text": words})
    assert r.status_code == 200, r.text
    return parse_agui(r.text)


@pytest.mark.parametrize(
    ("kind", "words", "tool", "entity"), CASES, ids=[c[0] for c in CASES]
)
def test_a_write_reaches_the_phone_when_its_tool_finishes_not_with_the_reply(
    client: TestClient,
    db: Session,
    monkeypatch: pytest.MonkeyPatch,
    kind: str,
    words: str,
    tool: dict[str, Any],
    entity: str,
) -> None:
    """Kai, 2026-11-12: a meal Fern logged showed as saved in the chat and
    reached the Nutrition screen only once Fern had finished writing its
    reply (3-12 s later, measured on the real model). The rows a tool wrote
    now follow its result at once, committed, in a ``changes`` event."""
    api = user(client, db)
    api.assign("chat")
    if kind == "habit":
        api.post("/habits/", {"name": "Stretch"})
    cursor = pull(api, client, 0)["cursor"]
    install(monkeypatch, say("", tool), say("Done."))

    events = stream(api, client, words)
    at = {
        "result": next(
            i for i, e in enumerate(events) if e.get("type") == "TOOL_CALL_RESULT"
        ),
        "words": next(
            i
            for i, e in enumerate(events)
            if e.get("type") == "TEXT_MESSAGE_CONTENT" and "Done" in str(e)
        ),
    }
    sent = [
        (i, e["value"])
        for i, e in enumerate(events)
        if e.get("type") == "CUSTOM" and e.get("name") == "changes"
    ]
    assert sent, [e.get("type") for e in events]
    i, value = sent[0]
    assert at["result"] < i < at["words"]
    (card,) = rows(value["changes"], "record_card")
    out = next(e for e in events if e.get("type") == "RUN_FINISHED")["result"]
    if card["row"]["state"] == "proposed":
        # Waiting for a Confirm: nothing is written yet but the card.
        assert rows(value["changes"], entity) == []
    else:
        mine = rows(value["changes"], entity)
        assert mine and not mine[0]["deleted"], value
        assert {c["id"] for c in mine} <= {c["id"] for c in out["changes"]}
    # Sent once committed: a pull now (nothing else running) has it.
    settled = pull(api, client, cursor)
    sent_ids = {c["id"] for c in value["changes"]}
    assert sent_ids <= {c["id"] for c in settled["changes"]}


def test_each_tool_of_a_reply_sends_its_own_rows(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    api = user(client, db)
    api.assign("chat")
    install(
        monkeypatch,
        say("", call("log_expense", amount=250, category="grab", payee="Grab")),
        say("", call("create_tasks", tasks=[{"title": "Buy milk"}])),
        say("Done."),
    )
    events = stream(api, client, "250 grab, and remind me to buy milk")
    sent = [e["value"] for e in events if e.get("name") == "changes"]
    assert len(sent) == 2, [e.get("name") or e.get("type") for e in events]
    money, todo = sent
    assert rows(money["changes"], "fin_record") and not rows(money["changes"], "task")
    assert rows(todo["changes"], "task") and not rows(todo["changes"], "fin_record")


def test_a_tool_that_writes_nothing_sends_no_changes(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    api = user(client, db, accounts=False)
    api.assign("chat")
    install(monkeypatch, say("", call("nutrition_status")), say("You're on track."))
    events = stream(api, client, "how am I doing on food today?")
    assert not [e for e in events if e.get("name") == "changes"]


def test_a_discarded_proposal_comes_back_with_the_decision(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    api = user(client, db, accounts=False)
    api.assign("chat")
    install(monkeypatch, say("", call("log_meal", **MEAL)), say("Waiting for your OK."))
    out = finished(api, client, "lunch was rice and adobo")
    (card,) = rows(out["changes"], "record_card")
    assert card["row"]["state"] == "proposed"
    with slow_writer():
        res = act(api, client, "capture.discard", card_id=card["id"])
    (after,) = rows(res["changes"], "record_card")
    assert after["row"]["state"] == "discarded"
    assert rows(res["changes"], "meal") == []


def test_a_replayed_decision_carries_no_rows(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A replay answers from its receipt: the rows may have moved on since."""
    api = user(client, db, accounts=False)
    api.assign("chat")
    install(monkeypatch, say("", call("log_meal", **MEAL)), say("Waiting."))
    card = rows(finished(api, client, "lunch")["changes"], "record_card")[0]
    op = {
        "op_id": str(uuid.uuid4()),
        "kind": "action",
        "name": "capture.confirm",
        "data": {"card_id": card["id"]},
    }
    first = client.post(f"{API}/sync/push", headers=api.h, json={"ops": [op]})
    again = client.post(f"{API}/sync/push", headers=api.h, json={"ops": [op]})
    assert rows(first.json()["results"][0]["changes"], "meal")
    (res,) = again.json()["results"]
    assert res["replayed"] is True and res["changes"] == []


def test_another_users_rows_never_ride_along(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    from app.modules.sync import written
    from app.modules.sync.models import SyncOpReceipt  # noqa: F401 - registry loaded
    from app.shared.context import make_ctx

    me = user(client, db, accounts=False)
    other = user(client, db, accounts=False)
    task = other.post("/tasks/", {"title": "Theirs"})
    ctx = make_ctx(db, me.user)  # type: ignore[attr-defined]
    assert written.changes(ctx, {("task", uuid.UUID(str(task["id"])))}) == []
    del monkeypatch


OUT = (
    Path(__file__).resolve().parents[4]
    / "mobile/src/live/__tests__/fixtures/fern-written.json"
)
U = uuid.UUID("8a1f6a52-2c36-4b8f-9d34-3b1f5f0f2a11")
UUID = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}")
INSTANT = re.compile(
    r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})"
)


@pytest.mark.skipif(
    not os.environ.get("RECORD_MOBILE_FIXTURES"),
    reason="rewrites the mobile fixture; set RECORD_MOBILE_FIXTURES=1",
)
def test_record_fixture(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Per record type, the reply's AG-UI events and what confirming and
    undoing its card return, for ``fern-writes-live.test.tsx``."""
    api = user(client, db)
    api.assign("chat")
    api.post("/habits/", {"name": "Stretch"})
    # What the device holds before Fern writes: accounts, categories, habit.
    rec: dict[str, Any] = {"seed": pull(api, client, 0)["changes"], "cases": {}}
    for kind, words, tool, _ in CASES:
        install(monkeypatch, say("", tool), say("Done."))
        me = str(uuid.uuid4())
        r = client.post(
            f"{API}/companion/ask/stream",
            headers=api.h,
            json={"id": me, "text": words},
        )
        events = parse_agui(r.text)
        out = next(e for e in events if e.get("type") == "RUN_FINISHED")["result"]
        card = rows(out["changes"], "record_card")[0]
        entry: dict[str, Any] = {"ask": {"id": me, "text": words}, "events": events}
        if card["row"]["state"] == "proposed":
            entry["confirm"] = act(api, client, "capture.confirm", card_id=card["id"])
        entry["undo"] = act(api, client, "capture.undo", card_id=card["id"])
        rec["cases"][kind] = entry

    text = json.dumps(rec, indent=2, ensure_ascii=False)
    keep = {str(api.user.id): str(U)}  # type: ignore[attr-defined]
    for slug, cid in api.cats().items():
        keep[cid] = str(derived_id("category", U, slug))
    seen: dict[str, str] = {}

    def sub(m: re.Match[str]) -> str:
        u = m.group(0)
        if u in keep:
            return keep[u]
        seen.setdefault(u, f"00000000-0000-4000-8000-{len(seen) + 1:012x}")
        return seen[u]

    text = UUID.sub(sub, text)
    text = INSTANT.sub("2026-10-19T04:00:00.000000Z", text)
    text = re.sub(r'"version": \d+', '"version": 1', text)
    OUT.write_text(text + "\n")
