"""The cross-module contract (``public.py``) and the stats contributor,
called the way other modules call them: inside a caller's use case."""

from datetime import datetime, time, timedelta

import pytest
from sqlmodel import Session

from app.modules.finance import public
from app.modules.finance.stats import contributor
from app.modules.stats.contract import Window
from app.modules.stats.public import DIRTY_KEY
from app.shared.day import DayClock
from app.shared.domain import HTTPException
from tests.utils.mobile import ctx_for, signed_in

TODAY = DayClock().today()


def _at(n: int, hh: int = 12) -> datetime:
    return datetime.combine(TODAY + timedelta(days=n), time(hh), tzinfo=DayClock().zone)


def test_public_logging_contract(db: Session) -> None:
    user, _ = signed_in(db)
    with ctx_for(user) as ctx:
        assert public.default_account(ctx) is None
        with pytest.raises(HTTPException):
            public.log_expense(ctx, amount_minor=100)  # no account yet
        ctx.session.rollback()
    with ctx_for(user) as ctx:
        from app.modules.finance import services
        from app.modules.finance.schema import AccountCreate

        gcash = services.add_account(
            ctx, data=AccountCreate(name="GCash", type="ewallet")
        )
        cash = services.add_account(ctx, data=AccountCreate(name="Cash", type="cash"))
        bpi = services.add_account(
            ctx, data=AccountCreate(name="BPI Savings", type="bank")
        )
        assert (
            public.default_account(ctx).id == gcash.id
        )  # first account becomes the default
        assert public.find_account(ctx, "gcash").id == gcash.id
        assert public.find_account(ctx, "bpi").id == bpi.id
        assert public.find_account(ctx, "savings").id == bpi.id
        assert public.find_account(ctx, "maya") is None
        food = public.resolve_category(ctx, "lunch")
        assert food is not None and food.slug == "dining"
        assert public.resolve_category(ctx, "sweldo", kind="income").slug == "salary"
        assert public.resolve_category(ctx, "Coffee").slug == "coffee"
        assert public.resolve_category(ctx, "") is None
        rec = public.log_expense(
            ctx,
            amount_minor=18_000,
            category_id=food.id,
            account_id=cash.id,
            payee="Jollibee",
            at=_at(-1),
        )
        inc = public.log_income(ctx, amount_minor=50_000)
        assert (
            inc.account_id == gcash.id and inc.category_id is not None
        )  # "Other income"
        t = public.log_transfer(
            ctx,
            amount_minor=10_000,
            from_account_id=bpi.id,
            to_account_id=gcash.id,
            fee_minor=1_500,
        )
        assert len(t) == 2 and t[1].fee_of == t[0].id
        with pytest.raises(HTTPException):
            public.log_expense(ctx, amount_minor=0)
        # An expense without an account goes to the last-used one (income
        # counts as a use; a transfer does not).
        assert public.log_expense(ctx, amount_minor=100).account_id == gcash.id
        p = public.add_planned(
            ctx, name="Netflix", amount_minor=54_900, day=TODAY + timedelta(days=5)
        )
        # public functions flush; they never commit and they mark stats dirty.
        assert (user.id, "finance", TODAY - timedelta(days=1)) in ctx.session.info[
            DIRTY_KEY
        ]
        ctx.commit()
        assert (
            public.spend_between(ctx, TODAY - timedelta(days=1), TODAY)
            == 18_000 + 100 + 1_500
        )
        assert public.spend_between(ctx, TODAY, TODAY) == 100 + 1_500
        public.delete_records(ctx, record_ids=[rec.id])
        assert public.spend_between(ctx, TODAY - timedelta(days=1), TODAY) == 1_600
        public.restore_records(ctx, record_ids=[rec.id])
        assert public.spend_between(ctx, TODAY - timedelta(days=1), TODAY) == 19_600
        public.delete_planned(ctx, planned_id=p.id)
        ans = public.advisor_answer(ctx, "is my emergency fund enough?")
        assert ans["intent"] == "emergency" and ans["working"]
        ctx.commit()


def test_stats_contributor(db: Session) -> None:
    user, _ = signed_in(db)
    with ctx_for(user) as ctx:
        w = Window(TODAY - timedelta(days=29), TODAY)
        prev = Window(TODAY - timedelta(days=59), TODAY - timedelta(days=30))
        assert contributor.area_rate(ctx, w) is None  # no accounts: nothing to rate
        assert contributor.metrics(ctx, w, prev) == []
        from app.modules.finance import services
        from app.modules.finance.schema import (
            AccountCreate,
            BudgetCreate,
            PlannedCreate,
        )

        a = services.add_account(
            ctx, data=AccountCreate(name="BPI", type="bank", opening_minor=10_000_000)
        )
        dining = public.resolve_category(ctx, "lunch")
        salary = public.resolve_category(ctx, "salary", kind="income")
        public.log_income(
            ctx,
            amount_minor=1_000_000,
            category_id=salary.id,
            account_id=a.id,
            at=_at(-2),
        )
        big = public.log_expense(
            ctx,
            amount_minor=600_000,
            category_id=dining.id,
            account_id=a.id,
            payee="Laptop",
            at=_at(-1),
        )
        services.add_budget(
            ctx,
            data=BudgetCreate(
                name="Food", limit_minor=100_000, category_ids=[dining.id]
            ),
        )
        anchor = TODAY - timedelta(days=7)
        services.add_planned(
            ctx,
            data=PlannedCreate.model_validate(
                {
                    "name": "Rent",
                    "type": "expense",
                    "amount_minor": 50_000,
                    "account_id": a.id,
                    "schedule": {"kind": "weekly", "every": 1, "anchor": anchor},
                    "start": anchor,
                }
            ),
        )
        ctx.commit()
        # savings rate 0.4 -> clamp(0.4/0.3)=1; the only budget is blown -> 0.
        assert contributor.area_rate(ctx, w) == pytest.approx(0.6)
        keys = [m.key for m in contributor.metrics(ctx, w, prev)]
        assert keys == ["savings-rate", "no-spend", "budgets", "runway", "spend-vs"]
        sr = next(
            m for m in contributor.metrics(ctx, w, prev) if m.key == "savings-rate"
        )
        assert (sr.value, sr.good_when) == ("40%", "up")
        misses = contributor.misses(ctx, w)
        kinds = {m.kind for m in misses}
        assert kinds == {"budget", "unpaid", "big"}
        assert any(m.id == f"fin-big-{big.id}" for m in misses)
        cal = contributor.calendar(ctx, Window(TODAY, TODAY + timedelta(days=7)))
        assert [c.title for c in cal] == ["Bill · Rent", "Bill · Rent"]
        prog = contributor.day_progress(ctx, [TODAY])
        assert (
            prog[TODAY].due == 2 and prog[TODAY].done == 0
        )  # today + last week's overdue
        facets = contributor.facets(ctx, w, prev)
        assert {f.key for f in facets} == {"savings", "budgets", "no-spend"}
        assert all(0 <= f.value <= 1 for f in facets)
        assert contributor.achievements(ctx) == []
