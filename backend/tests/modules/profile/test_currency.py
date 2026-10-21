"""The profile's currency end to end: a new user is PHP, a USD user sees $ in
capture follow-ups, Fern's prompt and snapshot, and the finance advisor's
prompt; an unknown code is refused."""

import json
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session

from tests.modules.capture.api.helpers import Api, call, card_of, install, say, user


def _usd(client: TestClient, db: Session) -> Api:
    api = user(client, db)
    p = api.patch("/profile", {"currency": "USD"})
    assert p["currency"] == "USD"
    return api


def test_a_new_profile_is_php_and_an_unknown_code_is_refused(
    client: TestClient, db: Session
) -> None:
    api = user(client, db, accounts=False)
    assert api.get("/profile")["profile"]["currency"] == "PHP"
    for bad in ("XXX", "usd", "KWD", "DOLLARS"):
        api.patch("/profile", {"currency": bad}, status=422)
    assert api.get("/profile")["profile"]["currency"] == "PHP"
    assert api.patch("/profile", {"currency": "JPY"})["currency"] == "JPY"


def test_a_php_user_still_gets_the_dollar_conversion(
    client: TestClient, db: Session
) -> None:
    api = user(client, db)
    card = card_of(api.capture("spent $10"), "expense")
    assert card["payload"]["amount_minor"] == 56_000
    assert card["payload"]["currency"] == "USD"
    assert "₱560 at ₱56/$" in card["warn"]


def test_a_usd_users_dollars_are_their_own_money(
    client: TestClient, db: Session
) -> None:
    api = _usd(client, db)
    card = card_of(api.capture("spent $12"), "expense")
    # no conversion, no foreign-currency warning, the question names $
    assert card["payload"]["amount_minor"] == 1200
    assert "currency" not in card["payload"]
    assert card["warn"] is None
    assert "What was $12 for?" in json.dumps(card, ensure_ascii=False)
    # the user's code is a money word too: "12 usd" reads as an expense
    assert card_of(api.capture("12 usd"), "expense")["payload"]["amount_minor"] == (
        1200
    )


def _system(model: Any) -> str:
    return str(model.seen[0][0].content)


def test_fern_is_told_the_users_currency(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    api = _usd(client, db)
    api.assign("chat")
    model = install(monkeypatch, say("Fine."))
    api.post("/companion/ask", {"text": "How am I doing?"})
    system = _system(model)
    assert "money is in US Dollar (USD, written $)" in system
    assert '"currency": "USD ($)"' in system
    assert "peso" not in system.lower() and "₱" not in system


def test_the_capture_agent_is_told_the_users_currency(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    api = _usd(client, db)
    api.assign("capture")
    model = install(
        monkeypatch, say("", call("log_expense", amount=12)), say("Logged.")
    )
    _, frames, _ = api.stream("spent 12")
    system = _system(model)
    assert "Amounts are in US Dollar (USD, written $)." in system
    assert "peso" not in system.lower()
    ask = next(d for e, d in frames if e == "ask")
    assert "$12" in json.dumps(ask, ensure_ascii=False)
