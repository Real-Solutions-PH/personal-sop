"""``logic.py`` against the prototype's outputs over its seed."""

from dataclasses import asdict
from datetime import date, timedelta
from typing import Any

import pytest

from app.modules.tasks import logic as L
from app.shared.day import DayClock
from tests.modules.tasks.golden import frozen_now, load, seed_state

CLOCK = DayClock()
NEXT = load("tasks-next-due")["data"]
STATS = load("tasks-stats")["data"]
TODAY = date.fromisoformat(STATS["today"])


def test_frozen_today_matches_the_business_day() -> None:
    assert CLOCK.day_of(frozen_now()) == TODAY


@pytest.mark.parametrize(
    "case",
    NEXT["cases"],
    ids=lambda c: f"{c['rule']}-{c['mode']}-{c['due']}-{c['done']}",
)
def test_next_due_grid(case: dict[str, Any]) -> None:
    got = L.next_due(
        {"rule": case["rule"], "mode": case["mode"]},
        date.fromisoformat(case["due"]),
        date.fromisoformat(case["done"]),
    )
    assert got.isoformat() == case["next"]


def test_next_due_grid_covers_month_end_and_leap_day() -> None:
    dues = {c["due"] for c in NEXT["cases"]}
    assert {"2028-02-29", "2027-02-28", "2026-01-31", "2026-12-31"} <= dues
    # monthly day 31 skips the short months; day 29 lands on the leap day.
    leap = [
        c
        for c in NEXT["cases"]
        if c["rule"] == {"kind": "monthly", "day": 29}
        and c["mode"] == "fixed"
        and c["due"] == "2028-02-28"
        and c["done"] == "2028-02-28"
    ]
    assert leap and leap[0]["next"] == "2028-02-29"


@pytest.mark.parametrize(
    "case", NEXT["repeat"], ids=lambda c: f"{c['rule']}-{c['mode']}"
)
def test_fmt_repeat(case: dict[str, Any]) -> None:
    assert L.fmt_repeat({"rule": case["rule"], "mode": case["mode"]}) == case["text"]


def test_fmt_repeat_none() -> None:
    assert L.fmt_repeat(None) is None


def _stats_json(s: L.TaskStats) -> dict[str, Any]:
    d = asdict(s)
    return {
        "from": s.first.isoformat(),
        "to": s.last.isoformat(),
        "done": s.done,
        "onTime": s.on_time,
        "late": s.late,
        "withDue": s.with_due,
        "onTimeRate": s.on_time_rate,
        "streak": s.streak,
        "bestStreak": s.best_streak,
        "clearDays": s.clear_days,
        "dueDays": s.due_days,
        "overdueNow": s.overdue_now,
        "reschedules": s.reschedules,
        "avgReschedules": s.avg_reschedules,
        "avgLateness": s.avg_lateness,
        "followThrough": s.follow_through,
        "captureShare": s.capture_share,
        "created": s.created,
        "perDay": [
            {"day": p["day"].isoformat(), "done": p["done"]} for p in d["per_day"]
        ],
        "byList": [dict(x) for x in d["by_list"]],
        "topPushed": [t.id for t in s.top_pushed],
    }


@pytest.mark.parametrize(
    "case",
    STATS["stats"],
    ids=lambda c: f"{c['days']}d-off{c['offset']}-groc{c['countGroceries']}",
)
def test_compute_stats(case: dict[str, Any]) -> None:
    state = seed_state(case["countGroceries"])
    first, last = L.stats_window(TODAY, case["days"], case["offset"])
    assert (first.isoformat(), last.isoformat()) == (case["from"], case["to"])
    got = _stats_json(L.compute_stats(state, first, last, TODAY, CLOCK))
    want = case["stats"]
    for key in (
        "onTimeRate",
        "avgReschedules",
        "avgLateness",
        "followThrough",
        "captureShare",
    ):
        if want[key] is None:
            assert got[key] is None, key
        else:
            assert got[key] == pytest.approx(want[key], rel=1e-12), key
        got.pop(key)
        want = {k: v for k, v in want.items() if k != key}
    assert got == want


def test_follow_through_formula_by_hand() -> None:
    # (onTime + 0.5 * late) / max(1, overdueNow + reschedules), read off the
    # 7-day golden row.
    row = STATS["stats"][0]["stats"]
    expect = (row["onTime"] + 0.5 * row["late"]) / max(
        1, row["overdueNow"] + row["reschedules"]
    )
    assert row["followThrough"] == pytest.approx(expect)


def _ids(ts: list[L.TaskView]) -> list[str]:
    return [t.id for t in ts]


def test_today_data() -> None:
    d = L.today_data(seed_state(), frozen_now(), CLOCK)
    want = STATS["todayData"]
    assert _ids(d.overdue) == want["overdue"]
    assert _ids(d.due) == want["due"]
    assert _ids(d.done_today) == want["doneToday"]
    assert _ids(d.done_due_today) == want["doneDueToday"]
    assert [
        {"day": u.day.isoformat(), "tasks": _ids(u.tasks)} for u in d.upcoming
    ] == want["upcoming"]
    assert _ids(d.later) == want["later"]
    assert _ids(d.inbox) == want["inbox"]
    assert _ids(d.starred) == want["starred"]
    assert d.shopping_open == want["shoppingOpen"]
    assert (d.next_reminder.id if d.next_reminder else None) == want["nextReminder"]
    assert d.ever_had_tasks is want["everHadTasks"]


def test_by_due_is_overdue_is_due_now() -> None:
    state = seed_state()
    live = [t for t in state.tasks if t.status != "deleted"]
    assert _ids(L.sort_by_due(live)) == STATS["byDue"]
    assert [t.id for t in state.tasks if L.is_overdue(t, TODAY)] == STATS["overdue"]
    now = frozen_now()
    assert [t.id for t in state.tasks if L.is_due_now(t, now, CLOCK)] == STATS["dueNow"]
    later = now + timedelta(hours=8)
    assert [t.id for t in state.tasks if L.is_due_now(t, later, CLOCK)] == STATS[
        "dueNowLater"
    ]


def test_today_progress_and_day_progress_agree_on_today() -> None:
    state = seed_state()
    want = STATS["contract"]["todayProgress"]
    p = L.today_progress(state, frozen_now(), CLOCK)
    assert (p.due, p.done) == (want["due"], want["done"])
    q = L.day_progress(state, TODAY, CLOCK)
    assert (q.due, q.done) == (want["due"], want["done"])


@pytest.mark.parametrize(
    ("x", "want"), [(0.5, 1), (1.5, 2), (2.5, 3), (-0.5, 0), (-1.5, -1), (0.49, 0)]
)
def test_js_round_halves_go_up(x: float, want: int) -> None:
    assert L.js_round(x) == want


@pytest.mark.parametrize(
    ("x", "want"),
    [(0.25, "0.3"), (0.35, "0.3"), (1.05, "1.1"), (2.0, "2.0"), (1.15, "1.1")],
)
def test_js_to_fixed(x: float, want: str) -> None:
    # Hand-read from node: (0.25).toFixed(1) === "0.3", (0.35).toFixed(1) ===
    # "0.3" (0.35 is 0.34999… in binary), (1.15).toFixed(1) === "1.1".
    assert L.js_to_fixed(x, 1) == want


def test_streak_counts_back_from_yesterday_when_nothing_is_done_today() -> None:
    want = STATS["statsNoToday"]
    full = seed_state()
    drop = set(want["removed"])
    state = L.TasksState(
        lists=full.lists,
        tasks=[t for t in full.tasks if t.id not in drop],
        events=full.events,
        count_groceries=full.count_groceries,
    )
    got = L.compute_stats(state, L.add_days(TODAY, -6), TODAY, TODAY, CLOCK)
    assert (got.streak, got.best_streak, got.done) == (
        want["streak"],
        want["bestStreak"],
        want["done"],
    )
