"""Loan arithmetic: installment splits, month clamping, the paid waterfall."""

from datetime import date

import pytest

from app.modules.shared_finance import logic


def test_twelve_thousand_in_six_is_two_thousand_each() -> None:
    rows = logic.monthly_installments(1_200_000, 6, date(2026, 11, 15), 15)
    assert [r.amount_minor for r in rows] == [200_000] * 6
    assert [r.due for r in rows] == [
        date(2026, 11, 15),
        date(2026, 12, 15),
        date(2027, 1, 15),
        date(2027, 2, 15),
        date(2027, 3, 15),
        date(2027, 4, 15),
    ]
    assert [r.n for r in rows] == [1, 2, 3, 4, 5, 6]


def test_leftover_centavos_go_on_the_earliest_and_sum_is_exact() -> None:
    rows = logic.monthly_installments(1_200_000, 7, date(2026, 1, 1), 1)
    assert sum(r.amount_minor for r in rows) == 1_200_000
    assert [r.amount_minor for r in rows] == [171_429] * 4 + [171_428] * 3


def test_day_past_this_month_starts_next_month_and_clamps() -> None:
    rows = logic.monthly_installments(300, 3, date(2026, 1, 20), 31)
    assert [r.due for r in rows] == [
        date(2026, 1, 31),
        date(2026, 2, 28),
        date(2026, 3, 31),
    ]
    later = logic.monthly_installments(200, 2, date(2026, 1, 20), 5)
    assert [r.due for r in later] == [date(2026, 2, 5), date(2026, 3, 5)]


def test_bad_counts_refused() -> None:
    with pytest.raises(ValueError):
        logic.monthly_installments(100, 0, date(2026, 1, 1), 1)
    with pytest.raises(ValueError):
        logic.monthly_installments(2, 3, date(2026, 1, 1), 1)


def test_summary_waterfall_states() -> None:
    rows = logic.monthly_installments(600_000, 3, date(2026, 1, 10), 10)
    # Paid 1.5 installments; today is past the second due date.
    s = logic.summary(600_000, rows, 300_000, 50_000, date(2026, 2, 20))
    assert [i.state for i in s.installments] == ["paid", "overdue", "upcoming"]
    assert [i.paid_minor for i in s.installments] == [200_000, 100_000, 0]
    assert s.remaining_minor == 300_000
    assert s.pending_minor == 50_000
    assert s.overdue_minor == 100_000
    assert s.next_due is not None and s.next_due.n == 2


def test_summary_due_today_partial_and_paid_off() -> None:
    rows = logic.monthly_installments(400, 2, date(2026, 3, 1), 1)
    due = logic.summary(400, rows, 0, 0, date(2026, 3, 1))
    assert due.installments[0].state == "due"
    part = logic.summary(400, rows, 300, 0, date(2026, 3, 2))
    assert part.installments[1].state == "partial"
    done = logic.summary(400, rows, 400, 0, date(2027, 1, 1))
    assert done.next_due is None
    assert done.remaining_minor == 0
    assert all(i.state == "paid" for i in done.installments)
