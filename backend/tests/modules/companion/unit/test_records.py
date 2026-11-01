"""Summing a person's records for Fern's ``query_records``: the arithmetic
the model is told never to do itself. Expected values are worked by hand."""

from datetime import date
from typing import Any

from app.modules.companion.records import summarize

FIRST, LAST = date(2026, 10, 26), date(2026, 10, 28)  # Mon to Wed: 3 days

MEALS = [
    {
        "day": "2026-10-26",
        "meal": "breakfast",
        "food": "Rice",
        "kcal": 205,
        "protein": 4,
    },
    {"day": "2026-10-26", "meal": "dinner", "food": "Beef", "kcal": 160, "protein": 20},
    {
        "day": "2026-10-28",
        "meal": "lunch",
        "food": "Chicken inasal",
        "kcal": 330,
        "protein": 40,
    },
    {"day": "2026-10-28", "meal": "lunch", "food": "Rice", "kcal": 205, "protein": 4},
]
METRICS = ("kcal", "protein")


def test_by_day_sums_each_day_and_names_the_denominator() -> None:
    out = summarize(MEALS, metrics=METRICS, group_by="day", first=FIRST, last=LAST)
    assert out["days_in_range"] == 3
    assert out["days_with_records"] == 2
    assert [(g["key"], g["count"], g["days"], g["sum"]) for g in out["groups"]] == [
        ("2026-10-26", 2, 1, {"kcal": 365, "protein": 24}),
        ("2026-10-28", 2, 1, {"kcal": 535, "protein": 44}),
    ]
    assert out["total"] == {"kcal": 900, "protein": 68}
    # 900 / 2 days with records; 68 / 2.
    assert out["average_per_logged_day"] == {"kcal": 450, "protein": 34}


def test_by_field_counts_days_and_averages_per_group() -> None:
    out = summarize(MEALS, metrics=METRICS, group_by="food", first=FIRST, last=LAST)
    rice = next(g for g in out["groups"] if g["key"] == "Rice")
    assert (rice["count"], rice["days"], rice["sum"]) == (
        2,
        2,
        {"kcal": 410, "protein": 8},
    )
    # 410 over the 2 days rice was eaten.
    assert rice["average_per_logged_day"] == {"kcal": 205, "protein": 4}
    # Largest first by the first metric, so "what did most of my calories
    # come from" reads off the top.
    assert [g["key"] for g in out["groups"]] == ["Rice", "Chicken inasal", "Beef"]


def test_by_week_starts_on_monday() -> None:
    rows = [
        {"day": "2026-10-25", "kcal": 100},  # Sunday: week of Oct 19
        {"day": "2026-10-26", "kcal": 200},  # Monday: week of Oct 26
    ]
    out = summarize(
        rows, metrics=("kcal",), group_by="week", first=date(2026, 10, 25), last=LAST
    )
    assert [(g["key"], g["sum"]["kcal"]) for g in out["groups"]] == [
        ("2026-10-19", 100),
        ("2026-10-26", 200),
    ]


def test_by_weekday() -> None:
    out = summarize(MEALS, metrics=METRICS, group_by="weekday", first=FIRST, last=LAST)
    assert [g["key"] for g in out["groups"]] == ["Mon", "Wed"]


def test_missing_values_are_skipped_not_zero() -> None:
    rows = [
        {"day": "2026-10-26", "sugar": 10},
        {"day": "2026-10-26", "sugar": None},
    ]
    out = summarize(rows, metrics=("sugar",), group_by="day", first=FIRST, last=LAST)
    assert out["total"] == {"sugar": 10}
    assert out["unknown"] == {"sugar": 1}


def test_contains_filters_text_fields() -> None:
    out = summarize(
        MEALS,
        metrics=METRICS,
        group_by="none",
        first=FIRST,
        last=LAST,
        contains="rice",
        search=("food",),
    )
    assert out["total"] == {"kcal": 410, "protein": 8}
    assert [r["food"] for r in out["records"]] == ["Rice", "Rice"]


def test_records_are_capped_newest_first_and_say_so() -> None:
    rows = [{"day": f"2026-10-{d:02d}", "kcal": d} for d in range(1, 29)]
    out = summarize(
        rows,
        metrics=("kcal",),
        group_by="none",
        first=date(2026, 10, 1),
        last=LAST,
        limit=5,
    )
    assert [r["day"] for r in out["records"]] == [
        "2026-10-28",
        "2026-10-27",
        "2026-10-26",
        "2026-10-25",
        "2026-10-24",
    ]
    assert out["truncated"] is True
    # The total still covers every row: 1 + 2 + ... + 28 = 406.
    assert out["total"] == {"kcal": 406}
    assert out["records_matched"] == 28


def test_nothing_recorded() -> None:
    out = summarize([], metrics=METRICS, group_by="day", first=FIRST, last=LAST)
    assert out["days_with_records"] == 0
    assert out["groups"] == []
    assert out["total"] == {"kcal": 0, "protein": 0}
    assert out["average_per_logged_day"] is None


def test_contains_reads_only_the_searchable_fields() -> None:
    rows = [{"day": "2026-10-26", "time": "12:30", "food": "Egg", "kcal": 70}]
    out = summarize(
        rows,
        metrics=("kcal",),
        group_by="none",
        first=FIRST,
        last=LAST,
        contains="12",
        search=("food",),
    )
    assert out["records_matched"] == 0


def test_levels_are_never_summed_even_in_groups() -> None:
    rows = [
        {"day": "2026-10-26", "kg": 75.0},
        {"day": "2026-10-26", "kg": 74.0},
        {"day": "2026-10-27", "kg": 74.5},
    ]
    out = summarize(rows, metrics=("kg",), group_by="week", first=FIRST, last=LAST)
    [week] = out["groups"]
    assert "kg" not in week["sum"]
    assert week["per_record"]["kg"] == {"average": 74.5, "min": 74.0, "max": 75.0}
    assert "kg" not in out["total"]


def test_each_metric_averages_over_the_days_it_was_known() -> None:
    # Monday's sugar is known (50 g), Tuesday's is not: the average is
    # 50 g over 1 day, not 25 g over 2.
    rows = [
        {"day": "2026-10-26", "kcal": 400, "sugar": 50},
        {"day": "2026-10-27", "kcal": 600, "sugar": None},
    ]
    out = summarize(
        rows, metrics=("kcal", "sugar"), group_by="none", first=FIRST, last=LAST
    )
    assert out["average_per_logged_day"] == {"kcal": 500, "sugar": 50}
    assert out["days_with_value"] == {"kcal": 2, "sugar": 1}
    assert out["unknown"] == {"sugar": 1}


def test_a_metric_a_row_lacks_is_not_unknown() -> None:
    # An income row has no spent_minor: it doesn't apply, it isn't unknown,
    # and its day doesn't dilute the spending average.
    rows = [
        {"day": "2026-10-26", "spent_minor": 100000},
        {"day": "2026-10-27", "received_minor": 5000000},
    ]
    out = summarize(
        rows,
        metrics=("spent_minor", "received_minor"),
        group_by="none",
        first=FIRST,
        last=LAST,
    )
    assert "unknown" not in out
    assert out["average_per_logged_day"] == {
        "spent_minor": 100000,
        "received_minor": 5000000,
    }


def test_weekday_groups_name_their_calendar_days() -> None:
    # Oct 19 to Oct 28 holds two Mondays (19, 26) and one Sunday (25).
    rows = [
        {"day": "2026-10-19", "spent_minor": 300},
        {"day": "2026-10-25", "spent_minor": 500},
    ]
    out = summarize(
        rows,
        metrics=("spent_minor",),
        group_by="weekday",
        first=date(2026, 10, 19),
        last=LAST,
    )
    mon, sun = out["groups"]
    assert (mon["key"], mon["calendar_days"]) == ("Mon", 2)
    assert mon["average_per_calendar_day"] == {"spent_minor": 150}
    assert (sun["key"], sun["calendar_days"]) == ("Sun", 1)
    assert sun["average_per_calendar_day"] == {"spent_minor": 500}


def test_money_text_leaves_counts_alone() -> None:
    from types import SimpleNamespace

    from app.modules.companion.records import _money
    from app.shared.currency import PHP, money

    ctx: Any = SimpleNamespace(currency=PHP)
    out = _money(
        {
            "total": {"spent_minor": 123400},
            "unknown": {"spent_minor": 3},
            "days_with_value": {"spent_minor": 2},
        },
        ctx,
    )
    assert out == {
        "total": {"spent": money(123400, PHP)},
        "unknown": {"spent": 3},
        "days_with_value": {"spent": 2},
    }


def test_a_per_group_metric_stays_out_of_the_whole() -> None:
    rows = [
        {"day": "2026-10-26", "habit": "Water", "value": 8},
        {"day": "2026-10-26", "habit": "Reading", "value": 30},
    ]
    out = summarize(
        rows,
        metrics=("value",),
        group_by="habit",
        first=FIRST,
        last=LAST,
        per_group_only=("value",),
    )
    assert out["total"] == {}
    assert {g["key"]: g["sum"]["value"] for g in out["groups"]} == {
        "Reading": 30,
        "Water": 8,
    }


def test_a_group_names_the_days_its_average_divides_by() -> None:
    # Rice on 2 days, sugar known on 1: 6 g over 1 day.
    rows = [
        {"day": "2026-10-26", "food": "Rice", "sugar": 6},
        {"day": "2026-10-27", "food": "Rice", "sugar": None},
    ]
    out = summarize(rows, metrics=("sugar",), group_by="food", first=FIRST, last=LAST)
    [rice] = out["groups"]
    assert rice["days"] == 2
    assert rice["days_with_value"] == {"sugar": 1}
    assert rice["average_per_logged_day"] == {"sugar": 6}
