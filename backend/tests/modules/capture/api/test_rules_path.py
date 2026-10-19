"""Captures read by the built-in rules (no AI model): every record kind
end to end, tiering, undo removing exactly the rows written, replay."""

import uuid

from fastapi.testclient import TestClient
from sqlmodel import Session, col, select

from app.core.db import engine as db_engine
from app.modules.finance.models import FinRecord
from tests.modules.capture.api.helpers import card_of, user


def _records(ids: list[str]) -> list[FinRecord]:
    with Session(db_engine) as s:
        return list(
            s.exec(
                select(FinRecord).where(
                    col(FinRecord.id).in_([uuid.UUID(i) for i in ids])
                )
            ).all()
        )


def test_expense_auto_saves_and_undo_removes_exactly_its_row(
    client: TestClient, db: Session
) -> None:
    api = user(client, db)
    cap = api.capture("spent 250 on grab")
    assert cap["status"] == "done" and cap["engine"] == "rules"
    card = card_of(cap, "expense")
    assert (card["tier"], card["state"]) == ("auto", "saved")
    assert card["payload"]["amount_minor"] == 25000
    assert len(card["refs"]) == 1
    rec = _records(card["refs"])[0]
    assert (rec.amount_minor, rec.deleted_at, str(rec.account_id)) == (
        25000,
        None,
        api.gcash,
    )
    # the fallback info card says the rules read it
    assert any(r["body"]["tone"] == "fallback" for r in cap["replies"])
    undone = api.post(f"/capture/cards/{card['id']}/undo")
    assert undone["state"] == "undone"
    assert _records(card["refs"])[0].deleted_at is not None
    redone = api.post(f"/capture/cards/{card['id']}/redo")
    assert redone["state"] == "saved" and redone["refs"] != card["refs"]
    assert [a["action"] for a in redone["log"]] == [
        "proposed",
        "saved",
        "undone",
        "redone",
    ]


def _module_rows(model: type, ids: list[str]) -> list:
    with Session(db_engine) as s:
        return list(
            s.exec(
                select(model).where(col(model.id).in_([uuid.UUID(i) for i in ids]))
            ).all()
        )


def test_multi_intent_splits_into_tiered_cards(client: TestClient, db: Session) -> None:
    from app.modules.fitness.models import Workout
    from app.modules.tasks.models import Task

    api = user(client, db)
    cap = api.capture(
        "ran 5k 32 min, spent 250 on grab, remind me to pay rent on the 30th"
    )
    kinds = [(c["kind"], c["tier"], c["state"]) for c in cap["cards"]]
    assert kinds == [
        ("workout", "auto", "saved"),
        ("expense", "auto", "saved"),
        ("task", "confirm", "proposed"),
    ]
    assert cap["reply_text"] == "Logged 2 things, one to confirm."
    workout = card_of(cap, "workout")
    assert _module_rows(Workout, workout["refs"])[0].status == "finished"
    task = card_of(cap, "task")
    done = api.post(f"/capture/cards/{task['id']}/confirm")
    assert done["state"] == "saved" and len(done["refs"]) == 1
    t = _module_rows(Task, done["refs"])[0]
    assert (t.title, t.due_date.day if t.due_date else None) == ("Pay rent", 30)
    # a replayed confirm is a no-op: same refs, no second task
    again = api.post(f"/capture/cards/{task['id']}/confirm")
    assert again["refs"] == done["refs"]
    # undo the task: exactly that row leaves; the workout stays
    api.post(f"/capture/cards/{task['id']}/undo")
    assert _module_rows(Task, done["refs"])[0].deleted_at is not None
    assert _module_rows(Workout, workout["refs"])[0].deleted_at is None
    api.post(f"/capture/cards/{workout['id']}/undo")
    assert _module_rows(Workout, workout["refs"])[0].deleted_at is not None


def test_replayed_capture_returns_the_same_capture_and_writes_once(
    client: TestClient, db: Session
) -> None:
    api = user(client, db)
    body = {"client_uuid": str(uuid.uuid4()), "text": "spent 180 on coffee"}
    first = api.post("/capture/", body, status=201)
    second = api.post("/capture/", body, status=200)
    assert second["id"] == first["id"]
    assert card_of(second, "expense")["refs"] == card_of(first, "expense")["refs"]
    with Session(db_engine) as s:
        n = len(
            s.exec(select(FinRecord).where(FinRecord.owner_id == api.user.id)).all()
        )  # type: ignore[attr-defined]
    assert n == 1


def test_tiering_threshold_rules_and_weigh_in_drift(
    client: TestClient, db: Session
) -> None:
    api = user(client, db)
    big = card_of(api.capture("spent 1500 on groceries"), "expense")
    assert (big["tier"], big["state"]) == ("confirm", "proposed")
    small = card_of(api.capture("spent 999 on groceries"), "expense")
    assert small["tier"] == "auto"
    api.patch(
        "/capture/settings",
        {"rules": {"expense": "confirm"}, "money_threshold_minor": 50000},
    )
    st = api.get("/capture/settings")
    assert st["rules"]["expense"] == "confirm" and st["rules"]["habit"] == "auto"
    assert card_of(api.capture("spent 100 on coffee"), "expense")["tier"] == "confirm"
    api.patch("/capture/settings", {"rules": {"expense": "auto"}})
    assert card_of(api.capture("spent 600 on coffee"), "expense")["tier"] == "confirm"
    first = card_of(api.capture("weighed 72.4"), "weighIn")
    assert first["tier"] == "auto"
    drift = card_of(api.capture("weighed 80.0"), "weighIn")
    assert drift["tier"] == "confirm" and "off your last weigh-in" in drift["warn"]
    api.patch("/capture/settings", {"rules": {"bogus": "auto"}}, status=422)


def test_missing_category_asks_then_saves_on_the_answer(
    client: TestClient, db: Session
) -> None:
    api = user(client, db)
    cats = api.cats()
    cap = api.capture("paid 500")
    card = card_of(cap, "expense")
    assert cap["status"] == "needs_input" and card["state"] == "needs_input"
    assert card["ask"]["field"] == "category_id"
    assert cats["electricity"] in [o["value"] for o in card["ask"]["options"]]
    out = api.post(
        f"/capture/cards/{card['id']}/answer", {"value": cats["electricity"]}
    )
    answered = card_of(out, "expense")
    assert (
        answered["state"] == "saved"
        and answered["payload"]["category_id"] == cats["electricity"]
    )
    assert out["status"] == "done"
    # a big one stays for confirmation even after the answer
    big = card_of(api.capture("paid 1500"), "expense")
    api.post(f"/capture/cards/{big['id']}/skip")
    assert api.get(f"/capture/cards/{big['id']}")["warn"].startswith("Skipped")
    out = api.post(f"/capture/cards/{big['id']}/answer", {"value": "internet bill"})
    assert card_of(out, "expense")["state"] == "proposed"
    api.post(f"/capture/cards/{big['id']}/answer", {"value": "x"}, status=409)


def test_transfer_asks_for_the_missing_side(client: TestClient, db: Session) -> None:
    api = user(client, db)
    card = card_of(api.capture("moved 2k to bpi"), "transfer")
    assert card["ask"]["field"] == "from"
    out = api.post(f"/capture/cards/{card['id']}/answer", {"value": api.gcash})  # type: ignore[attr-defined]
    t = card_of(out, "transfer")
    assert t["state"] == "proposed" and t["payload"]["from"] == api.gcash  # type: ignore[attr-defined]
    saved = api.post(f"/capture/cards/{t['id']}/confirm")
    assert saved["state"] == "saved"
    rec = _records(saved["refs"])[0]
    assert (rec.type, rec.amount_minor, str(rec.to_account_id)) == (
        "transfer",
        200000,
        api.bpi,
    )  # type: ignore[attr-defined]


def test_habits_routines_and_task_completion(client: TestClient, db: Session) -> None:
    from app.modules.habits.models import Habit, HabitLog

    api = user(client, db)
    h = api.post("/habits/", {"name": "Meditate 10m", "type": "duration", "target": 10})
    cap = api.capture("meditated 15 min")
    card = card_of(cap, "habitLog")
    assert card["state"] == "saved" and card["payload"]["habit_id"] == h["id"]
    lg = _module_rows(HabitLog, card["refs"])[0]
    assert (lg.value, lg.status) == (15, "done")
    api.post(f"/capture/cards/{card['id']}/undo")
    assert _module_rows(HabitLog, card["refs"])[0].deleted_at is not None
    # an unknown habit proposes creating it (new structure: confirm)
    create = card_of(api.capture("did my stretch"), "habitCreate")
    assert create["tier"] == "confirm"
    made = api.post(f"/capture/cards/{create['id']}/confirm")
    assert len(made["refs"]) == 2  # the habit and today's check
    api.post(f"/capture/cards/{create['id']}/undo")
    assert _module_rows(Habit, made["refs"][:1])[0].deleted_at is not None
    # completing a task by its words
    t = api.post("/tasks/", {"title": "Finish Q4 deck"})
    done = card_of(api.capture("finished the deck"), "taskComplete")
    assert done["state"] == "saved" and done["refs"] == [t["id"]]
    assert api.get(f"/tasks/{t['id']}")["status"] == "done"
    api.post(f"/capture/cards/{done['id']}/undo")
    assert api.get(f"/tasks/{t['id']}")["status"] == "open"


def test_journal_card_meal_command_and_answers(client: TestClient, db: Session) -> None:
    api = user(client, db)
    j = card_of(api.capture("journal: shipped the deck early, proud of it"), "journal")
    assert j["state"] == "saved"
    entry = api.get(f"/journal/{j['refs'][0]}")
    assert entry["private"] is True and entry["mood"] == 5 and entry["area"] == "career"
    meal = card_of(api.capture("lunch adobo with 1 cup rice"), "meal")
    assert meal["tier"] == "confirm"  # meals are estimates
    saved = api.post(f"/capture/cards/{meal['id']}/confirm")
    assert saved["state"] == "saved" and len(saved["refs"]) == 1
    # "change that to 300" edits the newest written card (the meal has no
    # amount, so: an expense first)
    exp = card_of(api.capture("spent 250 on grab"), "expense")
    cmd = card_of(api.capture("change that to 300"), "command")
    assert cmd["payload"]["record_id"] == exp["id"] and cmd["tier"] == "confirm"
    api.post(f"/capture/cards/{cmd['id']}/confirm")
    edited = api.get(f"/capture/cards/{exp['id']}")
    assert edited["state"] == "edited" and edited["payload"]["amount_minor"] == 30000
    assert _records(edited["refs"])[0].amount_minor == 30000
    assert (
        _records(exp["refs"])[0].deleted_at is not None or exp["refs"] == edited["refs"]
    )
    # undo of the command puts the old amount back
    api.post(f"/capture/cards/{cmd['id']}/undo")
    assert api.get(f"/capture/cards/{exp['id']}")["payload"]["amount_minor"] == 25000
    # a question gets an answer card, no records
    q = api.capture("how much did I spend this month?")
    assert q["status"] == "answered" and q["cards"] == []
    ans = next(r for r in q["replies"] if r["kind"] == "answer")
    assert (
        ans["body"]["title"].startswith("Spent on everything")
        and ans["body"]["money"] == 25000
    )
    vent = api.capture("ugh long day")
    assert vent["reply_text"] == "Heard you."


def test_card_state_machine_refusals(client: TestClient, db: Session) -> None:
    api = user(client, db)
    card = card_of(api.capture("spent 1500 on groceries"), "expense")
    api.post(f"/capture/cards/{card['id']}/undo", status=409)
    api.post(f"/capture/cards/{card['id']}/redo", status=409)
    api.post(f"/capture/cards/{card['id']}/discard")
    api.post(f"/capture/cards/{card['id']}/confirm", status=409)
    saved = card_of(api.capture("spent 100 on coffee"), "expense")
    api.post(f"/capture/cards/{saved['id']}/discard", status=409)
    api.patch(
        f"/capture/cards/{saved['id']}",
        {"payload": {"kind": "expense", "amount_minor": 12000}},
    )
    edited = api.get(f"/capture/cards/{saved['id']}")
    assert (
        edited["state"] == "edited"
        and _records(edited["refs"])[0].amount_minor == 12000
    )
    api.patch(
        f"/capture/cards/{saved['id']}",
        {"payload": {"kind": "expense", "amount_minor": 0}},
        status=422,
    )
    api.get(f"/capture/cards/{uuid.uuid4()}", status=404)


def test_a_second_user_sees_nothing(client: TestClient, db: Session) -> None:
    a = user(client, db)
    b = user(client, db, accounts=False)
    cap = a.capture("spent 1500 on groceries")
    card = card_of(cap, "expense")
    entry = a.post("/journal/", {"body": "private thoughts"}, status=201)
    b.get(f"/capture/{cap['id']}", status=404)
    b.get(f"/capture/cards/{card['id']}", status=404)
    b.post(f"/capture/cards/{card['id']}/confirm", status=404)
    b.get(f"/journal/{entry['id']}", status=404)
    b.patch(f"/journal/{entry['id']}", {"body": "x"}, status=404)
    assert b.get("/capture/")["count"] == 0
    assert b.get("/journal/")["count"] == 0
    # reusing A's client_uuid makes B's own capture, never A's
    mine = b.post(
        "/capture/", {"client_uuid": cap["client_uuid"], "text": "hello"}, status=201
    )
    assert mine["id"] != cap["id"]


def test_every_card_kind_undo_removes_exactly_what_it_wrote(
    client: TestClient, db: Session
) -> None:
    from app.modules.capture.models import JournalEntry
    from app.modules.finance.models import PlannedItem
    from app.modules.fitness.models import Meal, WeighIn
    from app.modules.habits.models import RoutineRun

    api = user(client, db)
    stretch = api.post("/habits/", {"name": "Stretch"})
    api.post(
        "/habits/routines",
        {
            "name": "Morning routine",
            "steps": [{"habit_id": stretch["id"], "minutes": 5}],
        },
    )
    cases: list[tuple[str, str, type | None]] = [
        ("got paid 35k to bpi", "income", FinRecord),
        ("netflix 549 every 5th", "planned", PlannedItem),
        ("weighed 72.4", "weighIn", WeighIn),
        ("lunch adobo with 1 cup rice", "meal", Meal),
        ("journal: a quiet good day", "journal", JournalEntry),
    ]
    for text, kind, model in cases:
        card = card_of(api.capture(text), kind)
        if card["state"] != "saved":
            card = api.post(f"/capture/cards/{card['id']}/confirm")
        assert card["state"] == "saved", (kind, card["warn"])
        assert model is not None
        rows = _module_rows(model, card["refs"])
        assert len(rows) == len(card["refs"]) >= 1
        assert all(r.deleted_at is None for r in rows)
        api.post(f"/capture/cards/{card['id']}/undo")
        assert all(
            r.deleted_at is not None for r in _module_rows(model, card["refs"])
        ), kind
        log = [x["action"] for x in api.get(f"/capture/cards/{card['id']}")["log"]]
        assert log[-1] == "undone" and "saved" in log
    # the routine starts on confirm and its run is the ref
    start = card_of(api.capture("started morning routine"), "routineStart")
    assert start["payload"]["routine_id"] and start["tier"] == "confirm"
    saved = api.post(f"/capture/cards/{start['id']}/confirm")
    assert saved["state"] == "saved"
    assert _module_rows(RoutineRun, saved["refs"])[0].state == "in_progress"
