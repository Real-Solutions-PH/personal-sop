"""The retention report's arithmetic, on hand-built people (no database).

Expected values are worked out by hand from the dates written in each test.
"""

import importlib.util
import uuid
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from types import ModuleType

import pytest


@pytest.fixture(scope="module")
def rr() -> ModuleType:
    path = Path(__file__).parents[2] / "scripts" / "retention_report.py"
    spec = importlib.util.spec_from_file_location("retention_report", path)
    assert spec and spec.loader
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


D = date(2026, 11, 1)  # a Sunday


def day(n: int) -> date:
    return D + timedelta(days=n)


def person(rr: ModuleType, signup: int, logs: dict[int, dict[str, int]], **kw: object):  # type: ignore[no-untyped-def]
    created = datetime.combine(day(signup), datetime.min.time(), timezone.utc)
    p = rr.Person(
        id=uuid.uuid4(),
        created_at=created,
        tz="UTC",
        referral=kw.get("referral"),
        onboarded=True,
        signup_day=day(signup),
    )
    p.days = {day(k): v for k, v in logs.items()}
    if logs:
        p.first_log_at = created + timedelta(hours=float(kw.get("first_h", 1)))  # type: ignore[arg-type]
    return p


def test_lapse_return_inside_and_outside_the_window(rr: ModuleType) -> None:
    # Logs day 0, then nothing on days 1-3: lapsed on day 4. A log on day 17
    # (4 + 14 - 1) is the last that counts as a return.
    assert rr.lapses([day(0), day(17)], today=day(40)) == [
        (day(4), True),
        (day(21), False),
    ]
    assert rr.lapses([day(0), day(18)], today=day(40))[0] == (day(4), False)


def test_two_quiet_days_are_not_a_lapse(rr: ModuleType) -> None:
    # Gap of days 1-2 only: back on day 3, before lapsing on day 4.
    assert rr.lapses([day(0), day(3)], today=day(5)) == []


def test_an_open_window_is_not_judged(rr: ModuleType) -> None:
    # Lapsed on day 4, window runs to day 17; today is day 10.
    assert rr.lapses([day(0)], today=day(10)) == [(day(4), None)]
    assert rr.lapses([day(0)], today=day(3)) == []


def test_retention_windows_only_count_once_passed(rr: ModuleType) -> None:
    p = person(rr, 0, {0: {"habits": 1}, 1: {"habits": 1}, 9: {"tasks": 2}})
    assert rr.retained(p, 1, 1, today=day(5)) is True
    assert rr.retained(p, 7, 7, today=day(20)) is True  # day 9 is in 7..13
    assert rr.retained(p, 7, 7, today=day(13)) is None  # window ends today
    assert rr.retained(p, 30, 7, today=day(40)) is False


def test_compute_counts_weekly_active_loggers(rr: ModuleType) -> None:
    today = day(15)  # Mon 2026-11-16; last complete week is Nov 9-15
    heavy = person(
        rr,
        0,
        {8: {"habits": 2}, 9: {"tasks": 1}, 10: {"finance": 3}},
        referral="friend",
    )
    light = person(rr, 0, {9: {"habits": 1}}, referral="tiktok")
    never = person(rr, 3, {})
    out = rr.compute(
        [heavy, light, never], today, {heavy.id: 4}, {heavy.id: (5, 250)}, None
    )
    last = [w for w in out["weeks"] if w["week"] == "2026-11-09"][0]
    assert last["active_1plus"] == 2
    assert last["wal_3plus"] == 1
    assert last["mean_log_days_of_active"] == 2.0
    assert out["ever_logged"] == 2
    assert out["referral"]["friend"] == {"signups": 1, "wal": 1}
    assert out["referral"]["tiktok"] == {"signups": 1, "wal": 0}
    assert out["referral"]["unanswered"] == {"signups": 1, "wal": 0}
    # 28-day window: 4 person-days, 7 entries.
    assert out["active_28d"] == 2
    assert out["entries_per_active_day"] == 1.75
    assert out["areas_per_active_person_28d"]["median"] == 2.0
    assert out["fern_28d"]["turns_per_active_logger"] == 2.0
    assert out["fern_28d"]["ai_cost_php"] == 2.5
    assert out["time_to_first_log_hours"]["within_24h"] == {
        "n": 2,
        "of": 3,
        "pct": 66.7,
    }
    assert out["usage"] == "usage_event table not present"


def test_usage_sessions_and_shares(rr: ModuleType) -> None:
    owner = uuid.uuid4()
    t = datetime(2026, 11, 10, 9, tzinfo=timezone.utc)
    rows = [
        (owner, "app_open", t, None),
        (owner, "app_close", t + timedelta(minutes=4), None),
        # Back within 30 minutes: the same session.
        (owner, "app_open", t + timedelta(minutes=10), None),
        (owner, "app_close", t + timedelta(minutes=12), None),
        # An hour later: a new session.
        (owner, "app_open", t + timedelta(hours=2), None),
        (owner, "share_card", t, "week-wrap"),
    ]
    out = rr.usage_summary(rows, today=date(2026, 11, 15))
    assert out["sessions_28d"] == 2
    assert out["share_cards_by_card"] == {"week-wrap": 1}
    assert out["people_opening_28d"] == 1


def test_plus_events_are_not_app_opens(rr: ModuleType) -> None:
    opener, buyer = uuid.uuid4(), uuid.uuid4()
    t = datetime(2026, 11, 10, 9, tzinfo=timezone.utc)
    rows = [
        (opener, "app_open", t, None),
        (opener, "paywall_shown", t + timedelta(minutes=1), None),
        # Written by the server from a RevenueCat webhook: no app open.
        (buyer, "purchased", t, "plus_yearly"),
        (buyer, "refunded", t + timedelta(days=1), "plus_yearly"),
    ]
    out = rr.usage_summary(rows, today=date(2026, 11, 15))
    assert out["people_opening_28d"] == 1
    assert out["sessions_28d"] == 1


def test_nudges_by_kind_and_arm(rr: ModuleType) -> None:
    """Sends, opens, open rate and logs within 2 h, by kind and by arm;
    held-back decisions are counted by reason and are not sends."""
    t = datetime(2026, 11, 10, 11, 0, tzinfo=timezone.utc)
    a, b = uuid.uuid4(), uuid.uuid4()
    rows = [
        # owner, kind, arm, suppressed, sent_at, opened_at, logged within 2 h
        (a, "best_time", "treated", None, t, t + timedelta(minutes=3), True),
        (a, "best_time", "treated", None, t, None, False),
        (b, "best_time", "treated", None, t, None, True),
        (b, "ladder_3", "treated", None, t, t + timedelta(hours=1), False),
        (b, "best_time", "holdout", "holdout", None, None, True),
        (a, "best_time", "treated", "active_today", None, None, False),
    ]
    out = rr.nudge_summary(rows)
    assert out["by_kind"]["best_time"] == {
        "sent": 3,
        "opened": 1,
        "open_rate_pct": 33.3,
        "logged_within_2h": 2,
    }
    assert out["by_kind"]["ladder_3"] == {
        "sent": 1,
        "opened": 1,
        "open_rate_pct": 100.0,
        "logged_within_2h": 0,
    }
    assert out["by_arm"]["treated"]["sent"] == 4
    assert out["by_arm"]["treated"]["eligible"] == 4
    # The holdout sends nothing but has a would-have-sent moment to compare.
    assert out["by_arm"]["holdout"] == {
        "eligible": 1,
        "sent": 0,
        "opened": 0,
        "open_rate_pct": None,
        "logged_within_2h": 1,
    }
    assert out["held_back"] == {"active_today": 1, "holdout": 1}
    assert out["people_nudged"] == 2


def test_nudges_absent_table_is_reported(rr: ModuleType) -> None:
    out = rr.compute([], D, {}, {}, None, None)
    assert out["nudges"] == "nudge table not present"
