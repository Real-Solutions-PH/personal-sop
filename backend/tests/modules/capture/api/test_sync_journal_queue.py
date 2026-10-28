"""Sync push/pull of captures, journal entries and AI settings, the card
actions over sync, the journal screens, and the queue and recovery paths."""

import uuid
from datetime import timedelta
from typing import Any

from fastapi.testclient import TestClient
from sqlmodel import Session

from app.core.db import engine as db_engine
from app.modules.capture.models import Capture
from tests.modules.capture.api.helpers import Api, card_of, user


def op(kind: str, name: str, row_id: Any = None, **data: Any) -> dict[str, Any]:
    return {
        "op_id": str(uuid.uuid4()),
        "kind": kind,
        "name": name,
        "id": str(row_id) if row_id else None,
        "data": data,
    }


def push(api: Api, *ops: dict[str, Any]) -> list[dict[str, Any]]:
    out = api.post("/sync/push", {"ops": list(ops)})
    return list(out["results"])


def pull(api: Api, cursor: int = 0) -> dict[str, list[dict[str, Any]]]:
    out = api.get("/sync/pull", cursor=cursor, limit=1000)
    by: dict[str, list[dict[str, Any]]] = {}
    for ch in out["changes"]:
        by.setdefault(ch["entity"], []).append(ch)
    return by


def test_a_pushed_raw_capture_is_read_on_the_server(
    client: TestClient, db: Session
) -> None:
    api = user(client, db)
    cap_id, cu = uuid.uuid4(), uuid.uuid4()
    first = op(
        "upsert",
        "capture",
        cap_id,
        client_uuid=str(cu),
        source="text",
        text="spent 1500 on groceries",
    )
    [res] = push(api, first)
    assert res["status"] == "applied" and res["row"]["status"] == "done"
    # replaying the same op (and a new op for the same capture) writes nothing new
    [again] = push(api, first)
    assert again["replayed"] is True
    [dup] = push(
        api,
        op("upsert", "capture", cap_id, client_uuid=str(cu), source="text", text="x"),
    )
    assert dup["status"] == "applied"
    changes = pull(api)
    [card] = [c["row"] for c in changes["record_card"]]
    assert card["state"] == "proposed" and card["capture_id"] == str(cap_id)
    assert {c["row"]["action"] for c in changes["card_write_log"]} == {"proposed"}
    # the card actions
    [conf] = push(api, op("action", "capture.confirm", card_id=card["id"]))
    assert conf["status"] == "applied" and conf["result"]["card"]["state"] == "saved"
    refs = conf["result"]["card"]["refs"]
    [undo] = push(api, op("action", "capture.undo", card_id=card["id"]))
    assert undo["result"]["card"]["state"] == "undone"
    [redo] = push(api, op("action", "capture.redo", card_id=card["id"]))
    assert (
        redo["result"]["card"]["state"] == "saved"
        and redo["result"]["card"]["refs"] != refs
    )
    [bad] = push(api, op("action", "capture.discard", card_id=card["id"]))
    assert (bad["status"], bad["code"]) == ("rejected", "card_state")
    # deleting the capture ships tombstones
    cursor = api.get("/sync/pull", cursor=0, limit=1)["cursor"]
    [gone] = push(api, op("delete", "capture", cap_id))
    assert gone["status"] == "applied"
    later = pull(api, cursor)
    assert any(c["deleted"] for c in later["capture"]) and any(
        c["deleted"] for c in later["record_card"]
    )


def test_a_pushed_capture_refused_by_the_cap_is_kept_failed(
    client: TestClient, db: Session
) -> None:
    api = user(client, db)
    api.patch("/capture/settings", {"ai_enabled": False})
    [res] = push(
        api,
        op(
            "upsert",
            "capture",
            uuid.uuid4(),
            client_uuid=str(uuid.uuid4()),
            source="text",
            text="hi",
        ),
    )
    assert res["status"] == "applied" and res["row"]["status"] == "failed"
    assert res["row"]["error_code"] == "ai_disabled"


def test_answer_and_edit_actions_and_read_only_entities(
    client: TestClient, db: Session
) -> None:
    api = user(client, db)
    cats = api.cats()
    card = card_of(api.capture("paid 300"), "expense")
    [ans] = push(
        api,
        op("action", "capture.answer", card_id=card["id"], value=cats["electricity"]),
    )
    assert ans["result"]["card"]["state"] == "saved"
    [ed] = push(
        api,
        op(
            "action",
            "capture.edit",
            card_id=card["id"],
            payload={"kind": "expense", "amount_minor": 32000},
        ),
    )
    assert ed["result"]["card"]["state"] == "edited"
    [ro] = push(api, op("upsert", "record_card", uuid.uuid4(), state="saved"))
    assert (ro["status"], ro["code"]) == ("rejected", "unknown_entity")


def test_journal_and_settings_sync(client: TestClient, db: Session) -> None:
    api = user(client, db)
    jid = uuid.uuid4()
    [created] = push(api, op("upsert", "journal_entry", jid, body="Quiet day.", mood=3))
    assert created["row"]["private"] is True and created["row"]["mood"] == 3
    [edited] = push(api, op("upsert", "journal_entry", jid, tags=["calm"]))
    assert edited["row"]["tags"] == ["calm"] and edited["row"]["body"] == "Quiet day."
    [missing] = push(api, op("upsert", "journal_entry", uuid.uuid4(), mood=2))
    assert missing["code"] == "missing_fields"
    [deleted] = push(api, op("delete", "journal_entry", jid))
    assert deleted["status"] == "applied"
    api.get(f"/journal/{jid}", status=404)
    [restored] = push(api, op("upsert", "journal_entry", jid, deleted_at=None))
    assert restored["status"] == "applied"
    assert api.get(f"/journal/{jid}")["body"] == "Quiet day."
    [st] = push(
        api,
        op(
            "upsert",
            "ai_settings",
            uuid.uuid4(),
            retention_days=7,
            rules={"meal": "auto"},
        ),
    )
    assert st["row"]["retention_days"] == 7 and st["row"]["rules"]["meal"] == "auto"
    assert st["row"]["rules"]["income"] == "confirm"
    changes = pull(api)
    assert {"journal_entry", "ai_settings"} <= set(changes)


def test_journal_screens(client: TestClient, db: Session) -> None:
    api = user(client, db)
    api.post("/habits/", {"name": "Journal"})
    e = api.post(
        "/journal/",
        {"body": "Grateful for the long walk", "tags": ["gratitude"], "area": "health"},
        status=201,
    )
    assert e["private"] is True and e["source"] == "text"
    api.post("/journal/", {"body": "Shipped it", "mood": 5}, status=201)
    listing = api.get("/journal/")
    assert listing["count"] == 2 and listing["streak"] == 1
    assert api.get("/journal/", q="walk")["count"] == 1
    assert api.get("/journal/", tag="gratitude")["count"] == 1
    assert api.get("/journal/", mood=5)["count"] == 1
    assert api.get("/journal/", area="health")["count"] == 1
    upd = api.patch(f"/journal/{e['id']}", {"mood": 4, "private": False})
    assert (upd["mood"], upd["private"]) == (4, False)
    api.patch(f"/journal/{e['id']}", {"mood": 9}, status=422)
    api.delete(f"/journal/{e['id']}")
    api.get(f"/journal/{e['id']}", status=404)
    assert api.post(f"/journal/{e['id']}/restore")["id"] == e["id"]
    api.post("/journal/", {"body": ""}, status=422)
    # the "Journal" habit was ticked for the entry's day (prototype rule)
    from sqlmodel import select

    from app.modules.habits.models import Habit, HabitLog

    with Session(db_engine) as s:
        h = s.exec(select(Habit).where(Habit.owner_id == api.user.id)).one()  # type: ignore[attr-defined]
        logs = s.exec(select(HabitLog).where(HabitLog.habit_id == h.id)).all()
        assert [(lg.status, lg.source) for lg in logs] == [("done", "capture")]


def test_mood_check_in_never_ticks_the_journal_habit(
    client: TestClient, db: Session
) -> None:
    from sqlmodel import select

    from app.modules.habits.models import Habit, HabitLog

    api = user(client, db)
    api.post("/habits/", {"name": "Journal"})
    api.post(
        "/journal/",
        {"body": "Mood check-in: Good", "mood": 4, "tags": ["check-in"]},
        status=201,
    )
    with Session(db_engine) as s:
        h = s.exec(select(Habit).where(Habit.owner_id == api.user.id)).one()  # type: ignore[attr-defined]
        assert s.exec(select(HabitLog).where(HabitLog.habit_id == h.id)).all() == []


def test_queue_retry_rerun_resume_delete_clear_retention(
    client: TestClient, db: Session
) -> None:
    from app.modules.finance.models import FinRecord

    api = user(client, db)
    queued = api.capture("spent 200 on coffee", queue_only=True)
    assert queued["status"] == "queued" and queued["cards"] == []
    assert api.get("/capture/queue")["count"] == 1
    done = api.post(f"/capture/{queued['id']}/retry")
    assert done["status"] == "done"
    api.post(f"/capture/{queued['id']}/retry", status=409)
    old = card_of(done, "expense")
    rerun = api.post(f"/capture/{queued['id']}/rerun", {"text": "spent 210 on coffee"})
    new = card_of(rerun, "expense")
    assert new["payload"]["amount_minor"] == 21000 and new["id"] != old["id"]
    with Session(db_engine) as s:
        assert s.get(FinRecord, uuid.UUID(old["refs"][0])).deleted_at is not None  # type: ignore[union-attr]
    # a capture stuck in "processing" for over a minute is resumed
    stuck = api.capture("spent 50 on coffee", queue_only=True)
    with Session(db_engine) as s:
        row = s.get(Capture, uuid.UUID(stuck["id"]))
        assert row is not None
        row.status, row.started_at = "processing", row.at - timedelta(minutes=5)
        s.add(row)
        s.commit()
    assert api.post(f"/capture/{stuck['id']}/resume")["status"] == "done"
    api.post(f"/capture/{stuck['id']}/resume", status=409)
    # retention: an old capture goes, a new one stays
    old_cap = api.capture("spent 60 on coffee", at="2026-01-01T08:00:00+08:00")
    api.patch("/capture/settings", {"retention_days": 30})
    assert api.post("/capture/retention/run")["count"] >= 1
    api.get(f"/capture/{old_cap['id']}", status=404)
    api.delete(f"/capture/{stuck['id']}")
    api.get(f"/capture/{stuck['id']}", status=404)
    assert api.post("/capture/clear")["count"] >= 1
    assert api.get("/capture/")["count"] == 0


def test_quick_add_saves_at_once_with_undo(client: TestClient, db: Session) -> None:
    api = user(client, db)
    cats = api.cats()
    cu = str(uuid.uuid4())
    cap = api.post(
        "/capture/quick-add",
        {
            "client_uuid": cu,
            "text": "Coffee",
            "payload": {
                "kind": "expense",
                "amount_minor": 16500,
                "category_id": cats["coffee"],
            },
        },
    )
    card = card_of(cap, "expense")
    assert cap["source"] == "quick_add" and card["state"] == "saved"
    again = api.post(
        "/capture/quick-add",
        {
            "client_uuid": cu,
            "text": "Coffee",
            "payload": {"kind": "expense", "amount_minor": 16500},
        },
    )
    assert again["id"] == cap["id"]
    assert api.post(f"/capture/cards/{card['id']}/undo")["state"] == "undone"
    api.post(
        "/capture/quick-add",
        {"client_uuid": str(uuid.uuid4()), "payload": {"kind": "nope"}},
        status=422,
    )


def test_pagination_and_settings_meter(client: TestClient, db: Session) -> None:
    api = user(client, db)
    for i in range(3):
        api.capture(f"spent {100 + i} on coffee")
    page = api.get("/capture/", limit=2)
    assert page["count"] == 3 and len(page["data"]) == 2
    assert (
        api.get("/capture/", skip=2, limit=2)["data"][0]["text"]
        == "spent 100 on coffee"
    )
    st = api.get("/capture/settings")
    assert st["spend_cap_minor"] == 50000 and st["money_threshold_minor"] == 100000
    assert st["spend_minor"] == 0 and st["calls"] == 0
    api.patch("/capture/settings", {"spend_cap_minor": -1}, status=422)
