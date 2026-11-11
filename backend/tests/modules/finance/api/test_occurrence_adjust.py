"""One scheduled date changed on its own: the ``planned_snooze`` row carries
the day it moved to (either way, up to two weeks) and its own amount, and
the projection and auto-log use that amount for that date only."""

import uuid
from datetime import date, timedelta
from typing import Any

from fastapi.testclient import TestClient
from sqlmodel import Session

from app.modules.finance.calc import add_months, month_of
from app.shared.ids import derived_id
from tests.modules.finance.api.helpers import Fin, op
from tests.utils.day import run_day
from tests.utils.mobile import signed_in

TODAY = run_day()


def _fin(client: TestClient, db: Session) -> tuple[Fin, str, str]:
    _, headers = signed_in(db)
    f = Fin(client, headers)
    return f, f.account("BPI", type="bank", opening=10_000_000), f.cats()["rent"]


def _plan(f: Fin, a: str, cat: str, start: date, **extra: Any) -> dict[str, Any]:
    out: dict[str, Any] = f.post(
        "/planned",
        {
            "name": "Storage unit",
            "type": "expense",
            "amount_minor": 300_000,
            "account_id": a,
            "category_id": cat,
            "schedule": {"kind": "daily", "every": 30},
            "start": start.isoformat(),
            **extra,
        },
    )
    return out


def _adjust(f: Fin, p: dict[str, Any], on: date, **data: Any) -> dict[str, Any]:
    sid = derived_id("planned-snooze", uuid.UUID(p["id"]), on.isoformat())
    return f.push(
        op(
            "upsert",
            "planned_snooze",
            sid,
            planned_id=p["id"],
            on_day=on.isoformat(),
            **data,
        )
    )[0]


def test_a_date_keeps_its_own_amount_and_moves_either_way(
    client: TestClient, db: Session
) -> None:
    f, a, cat = _fin(client, db)
    on = TODAY + timedelta(days=40)
    p = _plan(f, a, cat, on)
    res = _adjust(f, p, on, until_day=on.isoformat(), amount_minor=348_050)
    assert res["status"] == "applied", res
    assert res["row"]["amount_minor"] == 348_050
    assert res["row"]["until_day"] == on.isoformat()
    # Earlier, within two weeks, keeps the amount (field-level write).
    res = _adjust(f, p, on, until_day=(on - timedelta(days=3)).isoformat())
    assert res["status"] == "applied", res
    assert res["row"]["amount_minor"] == 348_050
    # A reset clears the amount and points the date at itself.
    res = _adjust(f, p, on, until_day=on.isoformat(), amount_minor=None)
    assert res["status"] == "applied", res
    assert res["row"]["amount_minor"] is None


def test_a_move_or_amount_out_of_range_is_refused(
    client: TestClient, db: Session
) -> None:
    f, a, cat = _fin(client, db)
    on = TODAY + timedelta(days=40)
    p = _plan(f, a, cat, on)
    early = _adjust(f, p, on, until_day=(on - timedelta(days=15)).isoformat())
    assert early["status"] == "rejected", early
    zero = _adjust(f, p, on, until_day=on.isoformat(), amount_minor=0)
    assert zero["status"] == "rejected", zero


def test_the_projection_counts_a_dates_own_amount(
    client: TestClient, db: Session
) -> None:
    f, a, cat = _fin(client, db)
    # Every 30 days from two months out: the month holding ``on`` has one date.
    on = TODAY + timedelta(days=62)
    p = _plan(f, a, cat, on)
    key = add_months(month_of(TODAY, 1), 0)

    def planned_in_month_of(day: date) -> int:
        months = {m["key"]: m for m in f.get("/projection")["months"]}
        k = month_of(day, 1)
        assert k >= key
        return int(months[k]["planned_minor"])

    before = planned_in_month_of(on)
    _adjust(f, p, on, until_day=on.isoformat(), amount_minor=500_000)
    assert planned_in_month_of(on) == before + 200_000


def test_auto_log_records_a_dates_own_amount(client: TestClient, db: Session) -> None:
    f, a, cat = _fin(client, db)
    on = TODAY - timedelta(days=5)
    p = _plan(f, a, cat, on, auto_log=True)
    _adjust(f, p, on, until_day=on.isoformat(), amount_minor=410_000)
    logged = f.post("/planned/auto-log")["data"]
    assert [(r["planned_on"], r["amount_minor"]) for r in logged] == [
        (on.isoformat(), 410_000)
    ]


def test_settling_without_an_amount_records_the_dates_own(
    client: TestClient, db: Session
) -> None:
    f, a, cat = _fin(client, db)
    on = TODAY + timedelta(days=3)
    p = _plan(f, a, cat, on)
    _adjust(f, p, on, until_day=on.isoformat(), amount_minor=410_000)
    rec = f.post("/planned/settle", {"planned_id": p["id"], "day": on.isoformat()})
    assert rec["amount_minor"] == 410_000


def test_snooze_never_passes_two_weeks_from_the_scheduled_day(
    client: TestClient, db: Session
) -> None:
    f, a, cat = _fin(client, db)
    on = TODAY + timedelta(days=3)
    p = _plan(f, a, cat, on)
    out = f.post(
        "/planned/snooze", {"planned_id": p["id"], "day": on.isoformat(), "days": 30}
    )
    assert out["until_day"] == (on + timedelta(days=14)).isoformat()
