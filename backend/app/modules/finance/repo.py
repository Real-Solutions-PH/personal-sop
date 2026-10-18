"""Finance data access: the per-user bootstrap (settings + default
categories) and the snapshot loader that feeds :mod:`calc`.

Repositories only flush; the use case commits.
"""

import uuid
from collections.abc import Iterable
from typing import Any

from sqlmodel import col

from app.modules.finance import calc
from app.modules.finance.models import (
    Account,
    Budget,
    BudgetCategory,
    Category,
    FinanceSettings,
    FinRecord,
    PlannedItem,
    PlannedSkip,
    PlannedSnooze,
)
from app.shared import owned_repo
from app.shared.context import Ctx
from app.shared.ids import derived_id

# The prototype's default categories: (slug, name, icon, discretionary,
# parent slug, kind). "adjust" (balance adjustments) and "fees" (transfer
# fees) are system rows: the server writes them by slug, so they cannot be
# deleted (they can be renamed or archived).
DEFAULT_CATEGORIES: tuple[tuple[str, str, str, bool, str | None, str], ...] = (
    ("food", "Food", "🍽️", True, None, "expense"),
    ("dining", "Dining out", "🍗", True, "food", "expense"),
    ("coffee", "Coffee", "☕", True, "food", "expense"),
    ("groceries", "Groceries", "🛒", False, "food", "expense"),
    ("transport", "Transport", "🚌", False, None, "expense"),
    ("grab", "Grab rides", "🚗", False, "transport", "expense"),
    ("commute", "Commute", "🚇", False, "transport", "expense"),
    ("bills", "Bills", "🧾", False, None, "expense"),
    ("electricity", "Electricity", "💡", False, "bills", "expense"),
    ("internet", "Internet", "📶", False, "bills", "expense"),
    ("phone", "Mobile plan", "📱", False, "bills", "expense"),
    ("rent", "Rent", "🏠", False, None, "expense"),
    ("subs", "Subscriptions", "🎬", True, None, "expense"),
    ("shopping", "Shopping", "🛍️", True, None, "expense"),
    ("entertainment", "Entertainment", "🎟️", True, None, "expense"),
    ("health", "Health", "💊", False, None, "expense"),
    ("personal", "Personal care", "💈", True, None, "expense"),
    ("gifts", "Gifts", "🎁", True, None, "expense"),
    ("fees", "Fees", "🏦", False, None, "expense"),
    ("adjust", "Balance adjustment", "⚖️", False, None, "expense"),
    ("salary", "Salary", "💼", False, None, "income"),
    ("freelance", "Side income", "💻", False, None, "income"),
    ("interest", "Interest", "📈", False, None, "income"),
    ("other-in", "Other income", "💰", False, None, "income"),
)
SYSTEM_SLUGS = frozenset({"adjust", "fees"})


def category_id_for(ctx: Ctx, slug: str) -> uuid.UUID:
    """The id a seeded category has for this user (the device mints the same)."""
    return derived_id("category", ctx.user_id, slug)


def seed_categories(ctx: Ctx) -> None:
    """Create the default categories that do not exist yet (live or dead:
    a category the user deleted stays deleted)."""
    existing = {
        c.slug
        for c in owned_repo.list_rows(
            ctx, Category, col(Category.slug).is_not(None), include_deleted=True
        )
    }
    for slug, name, icon, disc, parent, kind in DEFAULT_CATEGORIES:
        if slug in existing:
            continue
        owned_repo.insert(
            ctx,
            Category,
            {
                "name": name,
                "kind": kind,
                "icon": icon,
                "discretionary": disc,
                "parent_id": category_id_for(ctx, parent) if parent else None,
                "system": slug in SYSTEM_SLUGS,
                "slug": slug,
            },
            row_id=category_id_for(ctx, slug),
        )


def settings_row(ctx: Ctx) -> FinanceSettings:
    """The user's settings, creating them (and the default categories) on
    first touch. Flushes only."""
    row = owned_repo.find_one(ctx, FinanceSettings, include_deleted=True)
    if row is None:
        row = owned_repo.insert(
            ctx,
            FinanceSettings,
            {},
            row_id=derived_id("finance-settings", ctx.user_id, "settings"),
        )
        seed_categories(ctx)
    elif row.deleted_at is not None:
        owned_repo.restore(ctx, row)
    return row


def category_by_slug(ctx: Ctx, slug: str) -> Category | None:
    return owned_repo.find_one(ctx, Category, col(Category.slug) == slug)


def budget_category_ids(
    ctx: Ctx, budget_ids: Iterable[uuid.UUID]
) -> dict[uuid.UUID, list[uuid.UUID]]:
    ids = list(budget_ids)
    out: dict[uuid.UUID, list[uuid.UUID]] = {i: [] for i in ids}
    if not ids:
        return out
    for bc in owned_repo.list_rows(
        ctx,
        BudgetCategory,
        col(BudgetCategory.budget_id).in_(ids),
        order_by=[col(BudgetCategory.created_at), col(BudgetCategory.id)],
    ):
        out[bc.budget_id].append(bc.category_id)
    return out


def skips_and_snoozes(
    ctx: Ctx, planned_ids: Iterable[uuid.UUID]
) -> tuple[dict[uuid.UUID, set[Any]], dict[uuid.UUID, dict[Any, Any]]]:
    ids = list(planned_ids)
    skips: dict[uuid.UUID, set[Any]] = {i: set() for i in ids}
    snoozes: dict[uuid.UUID, dict[Any, Any]] = {i: {} for i in ids}
    if not ids:
        return skips, snoozes
    for sk in owned_repo.list_rows(
        ctx, PlannedSkip, col(PlannedSkip.planned_id).in_(ids)
    ):
        skips[sk.planned_id].add(sk.on_day)
    for sn in owned_repo.list_rows(
        ctx, PlannedSnooze, col(PlannedSnooze.planned_id).in_(ids)
    ):
        snoozes[sn.planned_id][sn.on_day] = sn.until_day
    return skips, snoozes


# ---------------------------------------------------------------------------
# Snapshot
# ---------------------------------------------------------------------------


def _s(v: uuid.UUID | None) -> str | None:
    return str(v) if v is not None else None


def acct_of(a: Account) -> calc.Acct:
    return calc.Acct(
        id=str(a.id),
        type=a.type,
        opening=a.opening_minor,
        in_net_worth=a.in_net_worth,
        in_projection=a.in_projection,
        archived=a.archived,
        manual=a.manual,
        name=a.name,
        last_reconciled=a.last_reconciled,
    )


def rec_of(ctx: Ctx, r: FinRecord) -> calc.Rec:
    return calc.Rec(
        id=str(r.id),
        type=r.type,
        amount=r.amount_minor,
        account_id=str(r.account_id),
        to_account_id=_s(r.to_account_id),
        category_id=_s(r.category_id),
        day=ctx.clock.day_of(r.at),
        payee=r.payee,
        planned_id=_s(r.planned_id),
        planned_on=r.planned_on,
        import_id=_s(r.import_id),
        is_refund=r.is_refund,
        is_adjustment=r.is_adjustment,
        source=r.source,
        status=r.status,
    )


def plan_of(
    p: PlannedItem,
    skipped: set[Any] | None = None,
    snoozed: dict[Any, Any] | None = None,
) -> calc.Plan:
    return calc.Plan(
        id=str(p.id),
        name=p.name,
        type=p.type,
        amount=p.amount_minor,
        account_id=str(p.account_id),
        to_account_id=_s(p.to_account_id),
        category_id=_s(p.category_id),
        schedule=dict(p.schedule),
        start=p.start,
        end_rule=dict(p.end_rule),
        auto_log=p.auto_log,
        is_what_if=p.is_what_if,
        in_projection=p.in_projection,
        archived=p.archived,
        estimated=p.estimated,
        skipped=skipped or set(),
        snoozed=snoozed or {},
    )


def load_state(ctx: Ctx, settings: FinanceSettings | None = None) -> calc.State:
    """Every live finance row of the user as a :class:`calc.State`.

    Balances need the whole record history (opening + every record), so the
    read is the user's full ledger; records come back ordered by timestamp
    (then id), the order the prototype's tie-breaks assume.
    """
    st = settings or settings_row(ctx)
    accounts = owned_repo.list_rows(
        ctx, Account, order_by=[col(Account.sort_order), col(Account.created_at)]
    )
    cats = owned_repo.list_rows(ctx, Category, order_by=[col(Category.created_at)])
    records = owned_repo.list_rows(
        ctx, FinRecord, order_by=[col(FinRecord.at), col(FinRecord.id)]
    )
    budgets = owned_repo.list_rows(ctx, Budget, order_by=[col(Budget.created_at)])
    bcats = budget_category_ids(ctx, [b.id for b in budgets])
    planned = owned_repo.list_rows(
        ctx, PlannedItem, order_by=[col(PlannedItem.created_at), col(PlannedItem.id)]
    )
    skips, snoozes = skips_and_snoozes(ctx, [p.id for p in planned])
    return calc.State(
        today=ctx.today,
        accounts=[acct_of(a) for a in accounts],
        categories=[
            calc.Cat(
                id=str(c.id),
                kind=c.kind,
                parent_id=_s(c.parent_id),
                discretionary=c.discretionary,
                archived=c.archived,
                system=c.system,
                name=c.name,
                slug=c.slug,
            )
            for c in cats
        ],
        records=[rec_of(ctx, r) for r in records],
        budgets=[
            calc.Bud(
                id=str(b.id),
                name=b.name,
                category_ids=[str(x) for x in bcats[b.id]] or None,
                limit=b.limit_minor,
                rollover=b.rollover,
                start_date=b.start_date,
                archived=b.archived,
            )
            for b in budgets
        ],
        planned=[plan_of(p, skips[p.id], snoozes[p.id]) for p in planned],
        settings=calc.Settings(month_start_day=st.month_start_day),
        cat_by_slug={c.slug: str(c.id) for c in cats if c.slug},
    )
