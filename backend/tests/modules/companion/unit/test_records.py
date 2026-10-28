"""Summing a person's records for Fern's ``query_records``: the arithmetic
the model is told never to do itself. Expected values are worked by hand."""

from datetime import date

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
    assert out["groups"] == [
        {
            "key": "2026-10-26",
            "count": 2,
            "days": 1,
            "sum": {"kcal": 365, "protein": 24},
        },
        {
            "key": "2026-10-28",
            "count": 2,
            "days": 1,
            "sum": {"kcal": 535, "protein": 44},
        },
    ]
    assert out["total"] == {"kcal": 900, "protein": 68}
    # 900 / 2 days with records; 68 / 2.
    assert out["average_per_day_with_records"] == {"kcal": 450, "protein": 34}


def test_by_field_counts_days_and_averages_per_group() -> None:
    out = summarize(MEALS, metrics=METRICS, group_by="food", first=FIRST, last=LAST)
    rice = next(g for g in out["groups"] if g["key"] == "Rice")
    assert rice == {
        "key": "Rice",
        "count": 2,
        "days": 2,
        "sum": {"kcal": 410, "protein": 8},
    }
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
        MEALS, metrics=METRICS, group_by="none", first=FIRST, last=LAST, contains="rice"
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
    assert out["average_per_day_with_records"] is None
