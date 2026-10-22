"""Fern changes and removes what the person already has: transactions,
scheduled payments, accounts, budgets and tasks, each as an undoable card
through the owning module's own rules."""

from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session

from app.modules.companion import routing
from tests.modules.capture.api.helpers import Api, call, install, say, user
from tests.modules.companion.api.test_fern_agent import (
    live,
    rows_of,
    setup_step,
    stream,
    undo,
)


def act(tool: str, /, **args: Any) -> dict[str, Any]:
    return {**call(tool), "args": args}


def planned(api: Api, name: str, account_id: str, amount_minor: int, day: int) -> str:
    body = {
        "name": name,
        "type": "expense",
        "amount_minor": amount_minor,
        "account_id": account_id,
        "schedule": {"kind": "monthly", "day": day},
    }
    return str(api.post("/finance/planned", body)["id"])


def test_moving_every_scheduled_item_off_an_account_and_undo_moves_them_back(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    from app.modules.finance.models import PlannedItem

    api: Any = user(client, db)
    api.assign("chat")
    black = api.account("Maya Black", "credit")
    savings = api.account("Maya Savings", "bank")
    planned(api, "Land payment", black, 3_600_000, 25)
    planned(api, "Gym", black, 100_000, 15)
    planned(api, "Rent", api.gcash, 1_200_000, 5)

    step = setup_step(
        api,
        client,
        "move all the scheduled payments from maya black to maya savings",
        monkeypatch,
        act("edit_scheduled", from_account="Maya Black", account="Maya Savings"),
    )
    assert step["tool"] == "edit_scheduled" and step["ok"]
    assert step["state"] == "saved"
    assert step["summary"] == "Moved 2 scheduled items to Maya Savings"
    on = {p.name: str(p.account_id) for p in live(rows_of(api, PlannedItem))}
    assert on == {"Land payment": savings, "Gym": savings, "Rent": api.gcash}

    undo(api, step)
    on = {p.name: str(p.account_id) for p in live(rows_of(api, PlannedItem))}
    assert on == {"Land payment": black, "Gym": black, "Rent": api.gcash}


def test_edit_transaction_changes_amount_and_payee_and_undo_restores(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    from app.modules.finance.models import FinRecord

    api: Any = user(client, db)
    api.assign("chat")
    rec = api.post(
        "/finance/records",
        {
            "type": "expense",
            "amount_minor": 25_000,
            "account_id": api.gcash,
            "payee": "Jollibee",
        },
    )["data"][0]

    step = setup_step(
        api,
        client,
        "that jollibee was 320 not 250, and it was mcdo",
        monkeypatch,
        act("edit_transaction", ids=[rec["id"]], amount=320, payee="McDonald's"),
    )
    assert step["ok"] and step["state"] == "saved", step
    assert step["summary"] == "Changed 1 transaction"
    [r] = live(rows_of(api, FinRecord))
    assert (r.amount_minor, r.payee) == (32_000, "McDonald's")

    undo(api, step)
    [r] = live(rows_of(api, FinRecord))
    assert (r.amount_minor, r.payee) == (25_000, "Jollibee")


def test_find_transactions_returns_ids_fern_can_edit(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    api: Any = user(client, db)
    api.assign("chat")
    for payee, amt in (("Grab", 18_000), ("Netflix", 54_900)):
        api.post(
            "/finance/records",
            {
                "type": "expense",
                "amount_minor": amt,
                "account_id": api.gcash,
                "payee": payee,
            },
        )
    step = setup_step(
        api,
        client,
        "find my netflix payment",
        monkeypatch,
        act("find_transactions", query="netflix"),
    )
    assert step["ok"] and step["summary"] == "Found 1 transaction"


def test_removing_a_transaction_waits_for_confirm_and_undo_brings_it_back(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    from app.modules.finance.models import FinRecord

    api: Any = user(client, db)
    api.assign("chat")
    rec = api.post(
        "/finance/records",
        {"type": "expense", "amount_minor": 9_900, "account_id": api.gcash},
    )["data"][0]

    step = setup_step(
        api,
        client,
        "delete that 99 expense, it was a mistake",
        monkeypatch,
        act("remove_item", what="transaction", ids=[rec["id"]]),
    )
    assert step["ok"] and step["state"] == "proposed"
    assert live(rows_of(api, FinRecord)) != []  # nothing gone before Confirm

    out = api.post(f"/capture/cards/{step['card_id']}/confirm")
    assert out["state"] == "saved"
    assert live(rows_of(api, FinRecord)) == []

    undo(api, step)
    assert [r.id for r in live(rows_of(api, FinRecord))] != []


def test_edit_account_makes_it_a_credit_card_and_undo_restores(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    from app.modules.finance.models import Account

    api: Any = user(client, db)
    api.assign("chat")
    api.account("Maya Black", "bank")
    step = setup_step(
        api,
        client,
        "maya black is a credit card with a 50k limit",
        monkeypatch,
        act("edit_account", account="Maya Black", type="credit", credit_limit=50000),
    )
    assert step["ok"] and step["state"] == "saved"
    acc = next(a for a in live(rows_of(api, Account)) if a.name == "Maya Black")
    assert (acc.type, acc.limit_minor) == ("credit", 5_000_000)

    undo(api, step)
    acc = next(a for a in live(rows_of(api, Account)) if a.name == "Maya Black")
    assert (acc.type, acc.limit_minor) == ("bank", None)


def test_edit_task_renames_and_reschedules_and_undo_restores(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    from app.modules.tasks.models import Task

    api: Any = user(client, db)
    api.assign("chat")
    api.post("/tasks/", {"title": "Call the bank", "due_date": "2026-10-23"})
    step = setup_step(
        api,
        client,
        "change the bank call to friday and call it call BPI",
        monkeypatch,
        act(
            "edit_task",
            task="call the bank",
            new_title="Call BPI",
            due_date="2026-10-30",
        ),
    )
    assert step["ok"] and step["state"] == "saved"
    [t] = live(rows_of(api, Task))
    assert (t.title, str(t.due_date)) == ("Call BPI", "2026-10-30")

    undo(api, step)
    [t] = live(rows_of(api, Task))
    assert (t.title, str(t.due_date)) == ("Call the bank", "2026-10-23")


def test_removing_an_account_archives_it_and_undo_unarchives(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    from app.modules.finance.models import Account

    api: Any = user(client, db)
    api.assign("chat")
    step = setup_step(
        api,
        client,
        "remove my cash account",
        monkeypatch,
        act("remove_item", what="account", name="Cash"),
    )
    assert step["ok"] and step["summary"] == "Archive: Cash (waiting for your OK)"
    api.post(f"/capture/cards/{step['card_id']}/confirm")
    cash = next(a for a in rows_of(api, Account) if a.name == "Cash")
    assert cash.archived and cash.deleted_at is None

    undo(api, step)
    cash = next(a for a in rows_of(api, Account) if a.name == "Cash")
    assert not cash.archived


def test_an_unknown_account_changes_nothing(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    api: Any = user(client, db)
    api.assign("chat")
    install(
        monkeypatch,
        say("", act("edit_scheduled", from_account="Nowhere", account="GCash")),
        say("I couldn't find that account."),
    )
    events = stream(api, client, "move everything from nowhere to gcash")
    step = events[-1]["result"]["messages"][1]["blocks"][0]["items"][0]
    assert not step["ok"]
    assert "no account with that name" in step["summary"]


@pytest.mark.parametrize(
    "text,tool",
    [
        ("move all scheduled from maya black to maya savings", "edit_scheduled"),
        ("delete that expense", "remove_item"),
        ("rename the gym task", "edit_task"),
        ("fix the amount of my last grab", "edit_transaction"),
        ("that jollibee was 320 not 250", "edit_transaction"),
        ("the rent should be 13000", "edit_scheduled"),
    ],
)
def test_words_about_changing_things_offer_the_edit_tools(text: str, tool: str) -> None:
    names = routing.pick(text, [])
    assert names is not None and tool in names
