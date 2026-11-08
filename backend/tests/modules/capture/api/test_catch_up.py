"""The way back's catch-up: one capture fills in the days the person did not
log. ``range_from`` (with ``hint="catch_up"``) bounds what the model may
date: a stated day lands on that day, a day outside the gap is clamped into
it, and with no model the whole note is kept as one journal entry on the
gap's last day. The daily check-in is an ordinary capture with its own
hint."""

from datetime import date, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session

from tests.modules.capture.api.helpers import call, card_of, install, say, user


def _range_from(days_back: int) -> str:
    # The business day is the server's; four days back is always in a gap
    # that ends yesterday.
    return (date.today() - timedelta(days=days_back)).isoformat()


def test_catch_up_dated_fact_lands_on_its_day(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    api = user(client, db)
    api.assign("capture")
    install(
        monkeypatch,
        say("", call("log_expense", amount=300, category="food", days_ago=2)),
        say("Filled in Tuesday."),
    )
    _, frames, _ = api.stream(
        "tuesday I spent 300 on food",
        hint="catch_up",
        range_from=_range_from(4),
    )
    done = frames[-1][1]
    assert card_of(done, "expense")["day_offset"] == -2


def test_catch_up_day_outside_range_is_clamped(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    api = user(client, db)
    api.assign("capture")
    install(
        monkeypatch,
        say("", call("log_expense", amount=300, category="food", days_ago=40)),
        say("Done."),
    )
    _, frames, _ = api.stream(
        "spent 300 on food back then", hint="catch_up", range_from=_range_from(4)
    )
    assert card_of(frames[-1][1], "expense")["day_offset"] == -4


def test_catch_up_day_inside_today_is_clamped_to_yesterday(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    api = user(client, db)
    api.assign("capture")
    install(
        monkeypatch,
        say("", call("log_expense", amount=300, category="food", days_ago=0)),
        say("Done."),
    )
    _, frames, _ = api.stream(
        "spent 300 on food", hint="catch_up", range_from=_range_from(4)
    )
    assert card_of(frames[-1][1], "expense")["day_offset"] == -1


def test_catch_up_prompt_carries_range_and_rules(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    api = user(client, db)
    api.assign("capture")
    model = install(monkeypatch, say("Nothing to log."))
    api.stream("skipped gym all week", hint="catch_up", range_from=_range_from(4))
    system = str(model.seen[0][0].content)
    assert "catching up on" in system
    assert "Never create an entry for a day they did not" in system


def test_catch_up_rules_fallback_writes_one_journal_entry(
    client: TestClient, db: Session
) -> None:
    api = user(client, db)
    cap = api.capture(
        "last week was chaos, skipped gym, ate takeaway most nights",
        hint="catch_up",
        range_from=_range_from(4),
    )
    records = [c for c in cap["cards"] if c.get("kind")]
    assert [c["kind"] for c in records] == ["journal"]
    assert records[0]["day_offset"] == -1


def test_range_from_without_catch_up_hint_is_422(
    client: TestClient, db: Session
) -> None:
    api = user(client, db)
    api.capture("hello", status=422, range_from=_range_from(4))


def test_range_from_not_before_today_is_422(client: TestClient, db: Session) -> None:
    api = user(client, db)
    api.capture(
        "hello", status=422, hint="catch_up", range_from=date.today().isoformat()
    )


def test_checkin_hint_is_accepted(client: TestClient, db: Session) -> None:
    api = user(client, db)
    cap = api.capture("spent 120 on coffee", hint="checkin")
    assert card_of(cap, "expense")["state"] in ("saved", "proposed")
