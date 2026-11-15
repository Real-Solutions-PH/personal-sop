"""``calc.due_for``: which unpaid scheduled date a newly logged transaction
pays (``dueFor`` in calc.ts, case for case with
``mobile/src/prototype/__tests__/finance-pay-overdue.test.ts``). Today is
Fri 6 Nov 2026; the gym bill is due on the 3rd, three days late. Days are
read off a calendar, never computed with the code under test."""

from dataclasses import replace
from datetime import date

from app.modules.finance import calc

TODAY = date(2026, 11, 6)
DUE = date(2026, 11, 3)


def gym(**kw: object) -> calc.Plan:
    p = calc.Plan(
        id="gym",
        name="Gym membership",
        type="expense",
        amount=100_000,
        # Its account is archived or gone: the row reads "No account".
        account_id="closed-account",
        category_id="health",
        schedule={"kind": "monthly", "day": 3},
        start=date(2026, 8, 3),
    )
    return replace(p, **kw)  # type: ignore[arg-type]


def state(*planned: calc.Plan, records: list[calc.Rec] | None = None) -> calc.State:
    return calc.State(
        today=TODAY,
        accounts=[calc.Acct(id="wallet", type="ewallet", opening=0)],
        categories=[],
        records=records or [],
        budgets=[],
        planned=list(planned),
    )


def rec(**kw: object) -> calc.Rec:
    r = calc.Rec(
        id="r",
        type="expense",
        amount=100_000,
        account_id="wallet",
        day=TODAY,
    )
    return replace(r, **kw)  # type: ignore[arg-type]


def hit(s: calc.State, r: calc.Rec) -> str | None:
    o = calc.due_for(s, r)
    return f"{o.item.id}@{o.orig.isoformat()}" if o else None


def test_the_bills_name_pays_the_overdue_date_not_next_months() -> None:
    assert hit(state(gym()), rec(payee="Gym membership")) == "gym@2026-11-03"
    assert hit(state(gym()), rec(payee="gym", category_id="fitness")) == (
        "gym@2026-11-03"
    )
    assert hit(state(gym()), rec(payee="GYM  Membership!")) == "gym@2026-11-03"


def test_no_payee_the_category_at_the_exact_amount() -> None:
    assert hit(state(gym()), rec(category_id="health")) == "gym@2026-11-03"
    assert hit(state(gym()), rec(category_id="health", amount=70_000)) is None


def test_what_does_not_pay_it() -> None:
    s = state(gym())
    assert hit(s, rec(payee="Coffee", amount=15_000, category_id="coffee")) is None
    # A small spend at the gym: the name, far from the amount.
    assert hit(s, rec(payee="Gym", amount=12_000)) is None
    assert hit(s, rec(payee="Gym membership", type="income")) is None
    assert hit(s, rec(payee="Gym membership", is_refund=True)) is None
    assert hit(state(gym(skipped={DUE})), rec(payee="Gym membership")) is None
    assert hit(state(gym(archived=True)), rec(payee="Gym membership")) is None
    paid = calc.Rec(
        id="paid",
        type="expense",
        amount=100_000,
        account_id="wallet",
        day=TODAY,
        planned_id="gym",
        planned_on=DUE,
    )
    # Paid already: nothing left in reach (3 Dec is weeks away).
    assert hit(state(gym(), records=[paid]), rec(payee="Gym membership")) is None


def test_name_beats_category_then_the_oldest_date() -> None:
    s = state(
        gym(),
        gym(id="older", schedule={"kind": "monthly", "day": 1}),
        gym(id="physio", name="Physio"),
    )
    got = hit(s, rec(payee="Gym membership", category_id="health"))
    assert got == "older@2026-11-01"


def test_income_settles_expected_income() -> None:
    salary = gym(
        id="salary",
        name="Salary",
        type="income",
        amount=5_000_000,
        category_id="salary",
        schedule={"kind": "monthly", "day": 5},
    )
    got = hit(state(salary), rec(type="income", amount=5_000_000, payee="salary"))
    assert got == "salary@2026-11-05"
