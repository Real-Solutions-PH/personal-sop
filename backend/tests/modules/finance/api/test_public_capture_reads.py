"""The reads and the statement hand-off capture makes through finance's
``public.py``, called inside a caller's use case (they flush, the caller
commits)."""

import uuid
from datetime import datetime, time, timedelta

from sqlmodel import Session, col

from app.modules.finance import calc, public, services
from app.modules.finance.models import ImportRow, StatementImport
from app.modules.finance.schema import AccountCreate, BudgetCreate
from app.shared import owned_repo
from app.shared.day import DayClock
from tests.utils.mobile import ctx_for, signed_in

TODAY = DayClock().today()


def _at(n: int, hh: int = 12) -> datetime:
    return datetime.combine(TODAY + timedelta(days=n), time(hh), tzinfo=DayClock().zone)


def test_accounts_categories_and_recent_counts(db: Session) -> None:
    user, _ = signed_in(db)
    with ctx_for(user) as ctx:
        cash = services.add_account(ctx, data=AccountCreate(name="Cash", type="cash"))
        old = services.add_account(ctx, data=AccountCreate(name="Old", type="bank"))
        services.update_account(
            ctx,
            account_id=old.id,
            data=AccountCreate(name="Old", type="bank", archived=True),
        )
        ids = (cash.id, old.id)
    cash_id, old_id = ids
    with ctx_for(user) as ctx:
        # Archived accounts are listed too (the parser filters them itself).
        assert [a.id for a in public.list_accounts(ctx)] == [cash_id, old_id]
        cats = public.list_categories(ctx)
        assert cats and all(not c.archived for c in cats)
        assert {c.kind for c in cats} == {"expense", "income"}
        assert [c.sort_order for c in cats] == sorted(c.sort_order for c in cats)
        slug = {c.slug: c.id for c in cats if c.slug}
        coffee, dining = slug["coffee"], slug["dining"]

        # Dining first in the window, then coffee twice; one of each outside
        # the window, an uncategorised one and an income are not counted.
        public.log_expense(ctx, amount_minor=100, category_id=dining, at=_at(-40))
        public.log_expense(ctx, amount_minor=100, category_id=dining, at=_at(-5))
        public.log_expense(ctx, amount_minor=100, category_id=coffee, at=_at(-4))
        public.log_expense(ctx, amount_minor=100, category_id=coffee, at=_at(-3))
        public.log_expense(ctx, amount_minor=100, at=_at(-2))
        public.log_income(ctx, amount_minor=100, category_id=slug["salary"], at=_at(-2))
        gone = public.log_expense(ctx, amount_minor=100, category_id=coffee, at=_at(-1))
        public.delete_records(ctx, record_ids=[gone.id])
        counts = public.expense_category_counts(ctx, since=_at(-30))
        assert counts == {dining: 1, coffee: 2}
        assert list(counts) == [dining, coffee]


def test_duplicate_expense_window(db: Session) -> None:
    user, _ = signed_in(db)
    with ctx_for(user) as ctx:
        services.add_account(ctx, data=AccountCreate(name="Cash", type="cash"))
        at = _at(-1)
        public.log_expense(ctx, amount_minor=54_900, payee="Netflix", at=at)
        public.log_expense(ctx, amount_minor=54_900, payee="Later", at=at + _h(20))
        assert public.find_duplicate_expense(
            ctx, amount_minor=54_900, at=at + _h(12)
        ) == (at, "Netflix")
        # Exactly a day away is outside the window on both sides.
        assert (
            public.find_duplicate_expense(ctx, amount_minor=54_900, at=at - _h(24))
            is None
        )
        assert public.find_duplicate_expense(ctx, amount_minor=54_901, at=at) is None


def _h(n: int) -> timedelta:
    return timedelta(hours=n)


def test_budget_left_and_state(db: Session) -> None:
    user, _ = signed_in(db)
    with ctx_for(user) as ctx:
        services.add_account(ctx, data=AccountCreate(name="Cash", type="cash"))
        cats = {c.slug: c.id for c in public.list_categories(ctx) if c.slug}
        # The seed nests dining and coffee under food; rent stands alone.
        food, dining, rent = cats["food"], cats["dining"], cats["rent"]
        services.add_budget(
            ctx,
            data=BudgetCreate(name="Food", limit_minor=50_000, category_ids=[food]),
        )
        ids = (food, dining, rent)
    food, dining, rent = ids
    with ctx_for(user) as ctx:
        assert public.budget_left(ctx, category_id=str(rent)) is None
        assert public.budget_left(ctx, category_id=str(food)) == ("Food", 50_000)
        public.log_expense(ctx, amount_minor=18_000, category_id=food, at=ctx.now)
        public.log_expense(ctx, amount_minor=2_000, category_id=dining, at=ctx.now)
        # A sub-category is covered through its parent's budget.
        assert public.budget_left(ctx, category_id=str(dining)) == ("Food", 30_000)
        public.log_expense(ctx, amount_minor=40_000, category_id=dining, at=ctx.now)
        assert public.budget_left(ctx, category_id=str(food)) == ("Food", -10_000)

        s = public.load_state(ctx)
        assert isinstance(s, calc.State)
        assert len(s.records) == 3
        assert public.calc is calc


def test_start_statement_import_flushes_only_and_replays(db: Session) -> None:
    user, _ = signed_in(db)
    imp_id = uuid.uuid4()
    rows = [
        {
            "date": TODAY.isoformat(),
            "raw": "JOLLIBEE",
            "amount_minor": 18_000,
            "direction": "out",
        },
    ]
    with ctx_for(user) as ctx:
        acct = services.add_account(ctx, data=AccountCreate(name="BPI", type="bank"))
        acct_id = acct.id
    with ctx_for(user) as ctx:
        got = public.start_statement_import(
            ctx,
            account_id=acct_id,
            file_name="",
            file_type="pdf",
            media_id=None,
            import_id=imp_id,
            rows=rows,
        )
        assert got == imp_id and ctx.in_batch is False
        imp = owned_repo.get(ctx, StatementImport, imp_id)
        assert imp is not None and imp.file_name == "statement"
        assert imp.status != "parsing"  # the rows were read
        ctx.session.rollback()  # nothing was committed
    with ctx_for(user) as ctx:
        assert owned_repo.get(ctx, StatementImport, imp_id) is None
        public.start_statement_import(
            ctx,
            account_id=acct_id,
            file_name="may.pdf",
            file_type="pdf",
            media_id=None,
            import_id=imp_id,
            rows=rows,
        )
        ctx.session.commit()
    with ctx_for(user) as ctx:
        # A replay returns the existing import without reading rows again.
        again = public.start_statement_import(
            ctx,
            account_id=acct_id,
            file_name="other.pdf",
            file_type="pdf",
            media_id=None,
            import_id=imp_id,
            rows=rows,
        )
        assert again == imp_id
        n = owned_repo.count_rows(ctx, ImportRow, col(ImportRow.import_id) == imp_id)
        assert n == 1
        imp = owned_repo.get(ctx, StatementImport, imp_id)
        assert imp is not None and imp.file_name == "may.pdf"
