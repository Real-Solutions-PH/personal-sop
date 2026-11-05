"""Fern offers once to bring back a hidden part it hears about.

"felt anxious today" with the Journal hidden: one ``module_intro`` block
(what the Journal adds, Turn on / Not for me), stored as offered on the
account so it is never made again. A write into a module switched off and
never offered gets the offer in place of the plain note; after "Not for
me" the note only says it won't show on Today, without asking.
"""

from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session

from tests.modules.capture.api.helpers import call, install, say, user
from tests.modules.companion.api.test_companion_answer_quality import ask


def blocks(out: dict[str, Any], t: str) -> list[dict[str, Any]]:
    return [b for b in out["messages"][1]["blocks"] if b["t"] == t]


def test_a_feeling_with_the_journal_hidden_is_offered_once(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    api = user(client, db, accounts=False)
    api.assign("chat")
    api.patch("/profile", {"enabled_extras": ["social", "weather", "calendar"]})
    install(monkeypatch, say("That sounds heavy."), say("Still here."))
    first = ask(api, "felt anxious today")
    assert blocks(first, "module_intro") == [
        {
            "t": "module_intro",
            "module": "journal",
            "text": "Journal is hidden. It keeps a daily mood check-in and "
            "notes like this one. Want it back?",
        }
    ]
    assert api.get("/profile")["profile"]["intro_offered"] == ["journal"]
    assert blocks(ask(api, "felt anxious again"), "module_intro") == []


def test_a_shown_journal_is_never_offered(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    api = user(client, db, accounts=False)
    api.assign("chat")
    install(monkeypatch, say("That sounds heavy."))
    assert blocks(ask(api, "felt anxious today"), "module_intro") == []


def test_the_first_write_into_an_off_module_offers_then_notes(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    api = user(client, db)
    api.assign("chat")
    api.patch("/profile/modules/finance", {"enabled": False})
    spend = [
        say("", call("log_expense", amount=250, category="Shopping")),
        say("Logged."),
    ]
    install(monkeypatch, *spend, *spend)
    first = ask(api, "spent 250 on socks")
    assert [b["module"] for b in blocks(first, "module_intro")] == ["finance"]
    assert blocks(first, "module_off") == []
    second = ask(api, "spent 250 on socks again")
    assert blocks(second, "module_intro") == []
    assert [b["module"] for b in blocks(second, "module_off")] == ["finance"]


def test_after_not_for_me_the_note_does_not_ask(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    api = user(client, db)
    api.assign("chat")
    api.patch("/profile/modules/finance", {"enabled": False})
    api.patch("/profile", {"intro_dismissed": ["finance"]})
    install(
        monkeypatch,
        say("", call("log_expense", amount=250, category="Shopping")),
        say("Logged."),
    )
    out = ask(api, "spent 250 on socks")
    assert blocks(out, "module_intro") == []
    assert blocks(out, "module_off") == [
        {
            "t": "module_off",
            "module": "finance",
            "text": "Finance is off, so this won't show on Today.",
            "ask": False,
        }
    ]
