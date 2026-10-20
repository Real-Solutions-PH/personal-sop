"""A card the owning module refuses to save says why, and the warning goes
once the card saves."""

import uuid

from fastapi.testclient import TestClient
from sqlmodel import Session

from tests.modules.capture.api.helpers import card_of, user

NO_ACCOUNT = "Add an account first"


def test_expense_without_an_account_says_add_an_account_then_clears(
    client: TestClient, db: Session
) -> None:
    api = user(client, db, accounts=False)
    card = card_of(api.capture("spent 250 on grab"), "expense")
    # the auto-save was refused: the card stays proposed and says why
    assert card["state"] == "proposed" and card["refs"] == []
    assert card["warn"] == NO_ACCOUNT
    again = api.post(f"/capture/cards/{card['id']}/confirm")
    assert (again["state"], again["warn"]) == ("proposed", NO_ACCOUNT)

    api.account("GCash")
    saved = api.post(f"/capture/cards/{card['id']}/confirm")
    assert saved["state"] == "saved" and len(saved["refs"]) == 1
    assert saved["warn"] is None
    assert api.get(f"/capture/cards/{card['id']}")["warn"] is None


def test_a_warning_the_card_was_drafted_with_survives_the_save(
    client: TestClient, db: Session
) -> None:
    api = user(client, db)
    api.capture("weighed 72.4")
    drift = card_of(api.capture("weighed 80.0"), "weighIn")
    assert "off your last weigh-in" in drift["warn"]
    saved = api.post(f"/capture/cards/{drift['id']}/confirm")
    assert saved["state"] == "saved" and saved["warn"] == drift["warn"]


def test_paths_that_refuse_with_an_error_carry_the_modules_code(
    client: TestClient, db: Session
) -> None:
    api = user(client, db, accounts=False)
    r = api.post(
        "/capture/quick-add",
        {
            "client_uuid": str(uuid.uuid4()),
            "text": "Coffee at Kanto",
            "payload": {"kind": "expense", "amount_minor": 12000},
        },
        status=422,
    )
    assert (r["code"], r["message"]) == ("no_account", NO_ACCOUNT)
    # the submitted text never comes back in the error
    assert "Kanto" not in api.texts[-1]
