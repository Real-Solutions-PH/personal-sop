"""Fern's "today": the same day and the same habit status as the Today screen.

Before the day rolls over (04:00 by default) the open day is still the
previous date, on the phone and here. Fern used to print that date in ISO and
explain that the records "haven't rolled over"; it now names the day the way
the person says it. A skipped habit counted as still to do in Fern's facts
while the Today screen counts it as handled ("Perfect day 7/7").
"""

from datetime import datetime, timezone
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session

from app.modules.companion import services
from app.shared import context
from tests.modules.capture.api.helpers import Api, install, say, user
from tests.modules.companion.api.test_companion_answer_quality import (
    ask,
    today_facts,
)


def habit(api: Api, name: str) -> str:
    return str(api.post("/habits/", {"name": name})["id"])


def test_a_skipped_habit_is_handled_not_pending_like_the_today_card(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    api = user(client, db, accounts=False)
    api.assign("chat")
    done, skipped, _open = (
        habit(api, "Fish oil"),
        habit(api, "Walk"),
        habit(api, "Bath"),
    )
    api.post(f"/habits/{done}/log", {})
    api.post(f"/habits/{skipped}/skip", {})
    model = install(monkeypatch, say("Two of three."))
    ask(api, "what are my habits for today")
    facts = today_facts(model)
    status = {h["habit"]: h["status"] for h in facts["habits_due_today"]}
    assert status == {"Fish oil": "done", "Walk": "skipped", "Bath": "to do"}
    # The Today card: 2 counted (3 due less 1 skipped), 1 done, 1 left.
    assert facts["habits_left_today"] == 1


def test_the_plan_leaves_out_a_skipped_habit(client: TestClient, db: Session) -> None:
    from app.modules.companion import grounding
    from app.shared.context import make_ctx

    api = user(client, db, accounts=False)
    skipped, _open = habit(api, "Walk"), habit(api, "Bath")
    api.post(f"/habits/{skipped}/skip", {})
    plan = grounding.plan(make_ctx(db, api.user))  # type: ignore[attr-defined]
    assert [p["what"] for p in plan] == ["Bath"]


def _system_at(
    client: TestClient,
    db: Session,
    monkeypatch: pytest.MonkeyPatch,
    now: datetime,
) -> str:
    api = user(client, db, accounts=False)
    api.assign("chat")
    real = context.make_ctx

    def at_now(session: Session, u: Any, _now: datetime | None = None) -> Any:
        return real(session, u, now=now)

    monkeypatch.setattr(services, "make_ctx", at_now, raising=False)
    monkeypatch.setattr(context, "make_ctx", at_now)
    model = install(monkeypatch, say("ok"))
    ask(api, "what are my tasks for today")
    return str(model.seen[0][0].content)


def test_before_rollover_today_is_named_as_the_open_day_not_an_iso_date(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    # Monday 2 November 03:33 in Manila (UTC+8): the day still open is Sunday.
    system = _system_at(
        client, db, monkeypatch, datetime(2026, 11, 1, 19, 33, tzinfo=timezone.utc)
    )
    now = system.split("NOW:", 1)[1].split("\n", 1)[0]
    assert "Sunday 1 November (2026-11-01) is still open" in now
    assert "it is Monday 2026-11-02 03:33 where they live" in now
    assert "never as YYYY-MM-DD" in now and "rolling over" in now


def test_after_rollover_today_is_the_calendar_day(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    system = _system_at(
        client, db, monkeypatch, datetime(2026, 11, 2, 1, 0, tzinfo=timezone.utc)
    )
    now = system.split("NOW:", 1)[1].split("\n", 1)[0]
    assert "today is Monday 2 November" in now and "09:00" in now
    assert "still open" not in now


def test_the_facts_name_the_day_instead_of_an_iso_date(
    client: TestClient, db: Session
) -> None:
    from app.modules.companion import grounding

    api = user(client, db, accounts=False)
    who = api.user  # type: ignore[attr-defined]
    ctx = context.make_ctx(
        db, who, now=datetime(2026, 11, 1, 19, 33, tzinfo=timezone.utc)
    )
    facts = grounding.snapshot(ctx)
    assert facts["day"] == "Sunday 1 November" and "date" not in facts
