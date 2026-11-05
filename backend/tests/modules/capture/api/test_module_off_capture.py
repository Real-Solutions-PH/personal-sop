"""A capture logged into a module switched off is kept, and says so with an
info card that offers to turn the module back on."""

from fastapi.testclient import TestClient
from sqlmodel import Session

from tests.modules.capture.api.helpers import card_of, user


def test_an_expense_with_finance_off_is_saved_and_noted(
    client: TestClient, db: Session
) -> None:
    api = user(client, db)
    api.patch("/profile/modules/finance", {"enabled": False})
    cap = api.capture("spent 250 on grab")
    assert card_of(cap, "expense")["state"] == "saved"
    notes = [r for r in cap["replies"] if r["body"].get("tone") == "module_off"]
    assert [n["body"] for n in notes] == [
        {
            "t": "info",
            "tone": "module_off",
            "title": "Finance is off",
            "body": "Saved, but it won't show on Today while it's off.",
            "actions": [
                {
                    "label": "Turn on Finance",
                    "do": "module_on",
                    "module": "finance",
                    "href": "/me/settings",
                }
            ],
        }
    ]


def test_finance_on_adds_no_note(client: TestClient, db: Session) -> None:
    api = user(client, db)
    cap = api.capture("spent 250 on grab")
    assert not [r for r in cap["replies"] if r["body"].get("tone") == "module_off"]


def test_a_weigh_in_with_only_finance_off_adds_no_note(
    client: TestClient, db: Session
) -> None:
    api = user(client, db)
    api.patch("/profile/modules/finance", {"enabled": False})
    cap = api.capture("weighed 72.4")
    assert not [r for r in cap["replies"] if r["body"].get("tone") == "module_off"]
