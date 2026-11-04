"""Recurring transactions: auto-log items with interval rules generate one
real record per occurrence, catch up on missed days, follow the user's
business day and never revive an occurrence the person deleted."""

import uuid
from datetime import date, timedelta
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session

from app.modules.finance import services
from app.modules.finance.services import AUTO_LOG_CATCH_UP_DAYS
from app.shared.day import DayClock
from tests.modules.finance.api.helpers import Fin
from tests.utils.mobile import ctx_for, signed_in

TODAY = DayClock().today()  # a new user has the default clock


def _setup(client: TestClient, db: Session) -> tuple[Any, Fin, str, str]:
    user, headers = signed_in(db)
    f = Fin(client, headers)
    return user, f, f.account("GCash"), f.cats()["rent"]


def _recurring(
    f: Fin,
    account: str,
    cat: str,
    schedule: dict[str, Any],
    start: date,
    **extra: Any,
) -> dict[str, Any]:
    body = {
        "name": "Storage unit",
        "type": "expense",
        "amount_minor": 250_000,
        "account_id": account,
        "category_id": cat,
        "schedule": schedule,
        "start": start.isoformat(),
        "auto_log": True,
        **extra,
    }
    out: dict[str, Any] = f.post("/planned", body)
    return out


def _logged(f: Fin) -> list[str]:
    return sorted(r["planned_on"] for r in f.post("/planned/auto-log")["data"])


def test_interval_rules_round_trip_and_validate(
    client: TestClient, db: Session
) -> None:
    _, f, a, cat = _setup(client, db)
    p = _recurring(f, a, cat, {"kind": "monthly", "day": 15, "every": 3}, TODAY)
    assert p["schedule"] == {"kind": "monthly", "day": 15, "every": 3}
    assert p["monthly_eq_minor"] == round(250_000 / 3)
    old = _recurring(f, a, cat, {"kind": "monthly", "day": 15}, TODAY)
    assert old["schedule"]["every"] == 1
    y = _recurring(f, a, cat, {"kind": "yearly", "month": 2, "day": 29}, TODAY)
    assert y["schedule"] == {"kind": "yearly", "month": 2, "day": 29, "every": 1}
    for bad in (
        {"kind": "monthly", "day": 15, "every": 0},
        {"kind": "yearly", "month": 13, "day": 1},
        {"kind": "daily", "every": 0},
    ):
        f.post(
            "/planned",
            {
                "name": "Bad",
                "type": "expense",
                "amount_minor": 1,
                "account_id": a,
                "schedule": bad,
            },
            status=422,
        )


def test_generation_is_idempotent_and_catches_up(
    client: TestClient, db: Session
) -> None:
    _, f, a, cat = _setup(client, db)
    _recurring(f, a, cat, {"kind": "daily", "every": 20}, TODAY - timedelta(days=50))
    expected = [(TODAY - timedelta(days=n)).isoformat() for n in (50, 30, 10)]
    assert _logged(f) == expected
    assert _logged(f) == []  # the second run finds nothing left to do
    assert f.balances()[a] == -750_000


def test_catch_up_stops_at_the_window(client: TestClient, db: Session) -> None:
    _, f, a, cat = _setup(client, db)
    assert AUTO_LOG_CATCH_UP_DAYS == 60
    _recurring(f, a, cat, {"kind": "daily", "every": 30}, TODAY - timedelta(days=95))
    # -95 and -65 are older than the window; -35 and -5 are in it.
    assert _logged(f) == [
        (TODAY - timedelta(days=35)).isoformat(),
        (TODAY - timedelta(days=5)).isoformat(),
    ]


def test_end_after_n_times_and_paused_items(client: TestClient, db: Session) -> None:
    _, f, a, cat = _setup(client, db)
    start = TODAY - timedelta(days=40)
    _recurring(
        f,
        a,
        cat,
        {"kind": "daily", "every": 10},
        start,
        end_rule={"kind": "count", "n": 2},
    )
    paused = _recurring(f, a, cat, {"kind": "daily", "every": 1}, start)
    f.patch(f"/planned/{paused['id']}", {"archived": True})
    assert _logged(f) == [start.isoformat(), (start + timedelta(days=10)).isoformat()]


def test_a_deleted_occurrence_stays_deleted(client: TestClient, db: Session) -> None:
    _, f, a, cat = _setup(client, db)
    _recurring(f, a, cat, {"kind": "daily", "every": 7}, TODAY - timedelta(days=7))
    first = f.post("/planned/auto-log")["data"]
    assert len(first) == 2
    gone = min(first, key=lambda r: r["planned_on"])
    f.delete(f"/records/{gone['id']}")
    assert _logged(f) == []
    f.get(f"/records/{gone['id']}", status=404)


def test_one_live_record_per_occurrence(client: TestClient, db: Session) -> None:
    user, f, a, cat = _setup(client, db)
    p = _recurring(f, a, cat, {"kind": "daily", "every": 1}, TODAY)
    rec = f.post("/planned/auto-log")["data"][0]
    with ctx_for(user) as ctx, pytest.raises(IntegrityError):
        # A second row under another id for the same (item, day).
        services._put_record(
            ctx,
            uuid.uuid4(),
            {
                "type": "expense",
                "amount_minor": 1,
                "account_id": uuid.UUID(a),
                "at": ctx.now,
                "planned_id": uuid.UUID(p["id"]),
                "planned_on": date.fromisoformat(rec["planned_on"]),
            },
        )
        ctx.session.flush()


def test_due_days_follow_the_users_business_day(
    client: TestClient, db: Session
) -> None:
    user, f, a, cat = _setup(client, db)
    clock = DayClock()
    _recurring(f, a, cat, {"kind": "daily", "every": 1}, TODAY - timedelta(days=1))
    day_starts = clock.start_of(TODAY)
    # Manila's day starts at 04:00 local = 20:00 UTC the day before: the
    # UTC calendar still says yesterday when the user's today has begun.
    assert day_starts.date() == TODAY - timedelta(days=1)
    with ctx_for(user, now=day_starts - timedelta(minutes=1)) as ctx:
        before = [r.planned_on for r in services.auto_log_due(ctx)]
    assert before == [TODAY - timedelta(days=1)]
    with ctx_for(user, now=day_starts + timedelta(minutes=1)) as ctx:
        after = [r.planned_on for r in services.auto_log_due(ctx)]
    assert after == [TODAY]
