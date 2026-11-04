"""Repeat rules of planned (recurring) items: intervals, month-end clamping,
leap years and end rules. Every expected date is read off a calendar, never
computed with the code under test."""

from datetime import date
from typing import Any

import pytest

from app.modules.finance import calc


def plan(
    schedule: dict[str, Any], start: str, end: dict[str, Any] | None = None
) -> calc.Plan:
    return calc.Plan(
        id="p",
        name="Bill",
        type="expense",
        amount=120_000,
        account_id="a",
        schedule=schedule,
        start=date.fromisoformat(start),
        end_rule=end or {"kind": "never"},
    )


def days(p: calc.Plan, first: str, last: str) -> list[str]:
    return [
        d.isoformat()
        for d in calc.occurrences(
            p, date.fromisoformat(first), date.fromisoformat(last)
        )
    ]


CASES: list[tuple[str, dict[str, Any], str, str, list[str]]] = [
    (
        "monthly on the 31st clamps to each month's last day",
        {"kind": "monthly", "day": 31},
        "2027-01-31",
        "2027-06-30",
        [
            "2027-01-31",
            "2027-02-28",
            "2027-03-31",
            "2027-04-30",
            "2027-05-31",
            "2027-06-30",
        ],
    ),
    (
        "the 30th in February is the 29th in a leap year",
        {"kind": "monthly", "day": 30},
        "2028-01-30",
        "2028-03-31",
        ["2028-01-30", "2028-02-29", "2028-03-30"],
    ),
    (
        "rows saved before intervals existed mean every month",
        {"kind": "monthly", "day": 5},
        "2026-11-04",
        "2027-01-31",
        ["2026-11-05", "2026-12-05", "2027-01-05"],
    ),
    (
        "every 2 months counts from the first day on or after the start",
        {"kind": "monthly", "day": 15, "every": 2},
        "2026-01-20",
        "2026-08-31",
        ["2026-02-15", "2026-04-15", "2026-06-15", "2026-08-15"],
    ),
    (
        "every 3 months on the 31st, clamped, across a year end",
        {"kind": "monthly", "day": 31, "every": 3},
        "2026-11-30",
        "2027-11-30",
        ["2026-11-30", "2027-02-28", "2027-05-31", "2027-08-31", "2027-11-30"],
    ),
    (
        "every 5 months across two year boundaries",
        {"kind": "monthly", "day": 15, "every": 5},
        "2026-10-15",
        "2028-06-30",
        ["2026-10-15", "2027-03-15", "2027-08-15", "2028-01-15", "2028-06-15"],
    ),
    (
        "yearly on 29 February is the 28th in common years",
        {"kind": "yearly", "month": 2, "day": 29},
        "2028-02-29",
        "2032-12-31",
        ["2028-02-29", "2029-02-28", "2030-02-28", "2031-02-28", "2032-02-29"],
    ),
    (
        "every 2 years from the first date on or after the start",
        {"kind": "yearly", "month": 3, "day": 1, "every": 2},
        "2026-11-04",
        "2032-12-31",
        ["2027-03-01", "2029-03-01", "2031-03-01"],
    ),
    (
        "every 10 days from the start",
        {"kind": "daily", "every": 10},
        "2026-12-25",
        "2027-01-31",
        ["2026-12-25", "2027-01-04", "2027-01-14", "2027-01-24"],
    ),
    (
        "every 2 weeks on the anchor's weekday",
        {"kind": "weekly", "every": 2, "anchor": "2026-11-06"},
        "2026-11-06",
        "2026-12-31",
        ["2026-11-06", "2026-11-20", "2026-12-04", "2026-12-18"],
    ),
]


@pytest.mark.parametrize(
    ("schedule", "start", "last", "expected"),
    [c[1:] for c in CASES],
    ids=[c[0] for c in CASES],
)
def test_repeat_rule(
    schedule: dict[str, Any], start: str, last: str, expected: list[str]
) -> None:
    assert days(plan(schedule, start), start, last) == expected


def test_window_inside_the_series_keeps_the_interval_phase() -> None:
    p = plan({"kind": "monthly", "day": 15, "every": 5}, "2026-10-15")
    assert days(p, "2027-04-01", "2028-02-01") == ["2027-08-15", "2028-01-15"]


def test_end_after_n_times_counts_from_the_start() -> None:
    p = plan(
        {"kind": "monthly", "day": 15, "every": 3},
        "2026-11-01",
        {"kind": "count", "n": 3},
    )
    assert days(p, "2026-11-01", "2028-12-31") == [
        "2026-11-15",
        "2027-02-15",
        "2027-05-15",
    ]
    # Asking for a later window still stops after the third.
    assert days(p, "2027-04-01", "2028-12-31") == ["2027-05-15"]


def test_end_on_a_date_is_inclusive() -> None:
    p = plan(
        {"kind": "monthly", "day": 15, "every": 2},
        "2026-11-01",
        {"kind": "date", "date": "2027-03-15"},
    )
    assert days(p, "2026-11-01", "2028-12-31") == [
        "2026-11-15",
        "2027-01-15",
        "2027-03-15",
    ]


@pytest.mark.parametrize(
    ("schedule", "monthly"),
    [
        ({"kind": "monthly", "day": 1}, 120_000),
        ({"kind": "monthly", "day": 1, "every": 3}, 40_000),
        ({"kind": "yearly", "month": 1, "day": 1}, 10_000),
        ({"kind": "yearly", "month": 1, "day": 1, "every": 2}, 5_000),
        ({"kind": "daily", "every": 1}, 120_000 * 365 / 12),
    ],
)
def test_monthly_equivalent(schedule: dict[str, Any], monthly: float) -> None:
    assert calc.monthly_eq(plan(schedule, "2026-11-01")) == pytest.approx(monthly)
