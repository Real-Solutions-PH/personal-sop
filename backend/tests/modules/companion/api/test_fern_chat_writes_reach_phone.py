"""What a Fern turn saves reaches the phone with the finished reply.

Seen live on 2026-11-07: a ₱29 7-Eleven expense logged a second time came
back as a duplicate ("Keep both?") with choice chips and Fern's money card.
After "Keep both — separate purchases" the card still read "Spent today ₱0":
the confirmed expense never reached the phone's finance records. The phone
draws the card from those records, so the row has to ride on the reply."""

from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.core.db import engine as db_engine
from app.modules.finance.models import FinRecord
from tests.modules.capture.api.helpers import call, install, parse_agui, say, user


def stream(client: TestClient, api: Any, text: str) -> list[dict[str, Any]]:
    r = client.post("/api/v1/companion/ask/stream", headers=api.h, json={"text": text})
    assert r.status_code == 200, r.text
    return parse_agui(r.text)


def records_of(api: Any) -> list[FinRecord]:
    with Session(db_engine) as s:
        return list(
            s.exec(select(FinRecord).where(FinRecord.owner_id == api.user.id)).all()  # type: ignore[attr-defined]
        )


def fin_rows(events: list[dict[str, Any]]) -> list[dict[str, Any]]:
    out = events[-1]["result"]
    return [c for c in out.get("changes") or [] if c["entity"] == "fin_record"]


def test_keep_both_on_a_duplicate_sends_the_saved_expense_with_the_reply(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    api = user(client, db)
    api.assign("chat")
    install(
        monkeypatch,
        say("", call("log_expense", amount=29, payee="7-Eleven", category="food")),
        say("Logged ₱29 at 7-Eleven."),
    )
    first = stream(client, api, "29 at 7-eleven")
    assert len(records_of(api)) == 1
    assert len(fin_rows(first)) == 1

    install(
        monkeypatch,
        say("", call("log_expense", amount=29, payee="7-Eleven", category="food")),
        say("That looks like the ₱29 you already logged. Keep both?"),
    )
    stream(client, api, "29 at 7-eleven again")
    # The duplicate waits for a decision.
    assert len(records_of(api)) == 1

    install(
        monkeypatch,
        say("", call("confirm_pending")),
        say("Kept both: two ₱29 purchases at 7-Eleven."),
    )
    kept = stream(client, api, "Keep both — separate purchases")
    saved = records_of(api)
    assert len(saved) == 2
    new = next(r for r in saved if str(r.id) not in {c["id"] for c in fin_rows(first)})
    # The phone applies these rows at once (no pull needed): the money card
    # reads them.
    assert str(new.id) in {c["id"] for c in fin_rows(kept)}
