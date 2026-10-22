"""Cross-module contract of the finance module (implemented by finance).

Amounts are integer centavos. These functions only flush: the calling use
case (the capture or companion module) commits.
"""

import re
import uuid
from datetime import date, datetime, timedelta
from typing import Any, Literal

from sqlalchemy import and_, case, func, or_
from sqlmodel import col, select

from app.modules.finance import advisor, imports, repo, services
from app.modules.finance import calc as calc
from app.modules.finance import schema as S
from app.modules.finance.models import (
    Account,
    Budget,
    Category,
    FinRecord,
    PlannedItem,
    StatementImport,
)
from app.shared import owned_repo
from app.shared.context import Ctx
from app.shared.domain import conflict

# ``calc`` is re-exported for read-only use: the deterministic Q&A computes
# over ``load_state`` with it.

RecordSource = Literal[
    "chat", "quick-add", "photo", "import", "planned", "manual", "adjustment"
]

# Free-text words people use for a category ("sweldo" is Tagalog for salary).
CATEGORY_WORDS: dict[str, tuple[str, ...]] = {
    "dining": (
        "lunch",
        "dinner",
        "breakfast",
        "merienda",
        "jollibee",
        "mcdo",
        "resto",
        "food",
    ),
    "coffee": ("coffee", "kape", "starbucks", "latte"),
    "groceries": ("grocery", "groceries", "palengke", "market", "supermarket"),
    "grab": ("grab", "taxi", "angkas", "joyride"),
    "commute": ("jeep", "mrt", "lrt", "bus", "fare", "commute", "trike"),
    "electricity": ("meralco", "electric", "kuryente"),
    "internet": ("pldt", "wifi", "internet", "converge", "globe fiber"),
    "phone": ("load", "smart", "postpaid", "mobile plan"),
    "rent": ("rent", "upa"),
    "subs": ("netflix", "spotify", "icloud", "subscription", "youtube"),
    "shopping": ("shopee", "lazada", "shopping", "clothes"),
    "entertainment": ("movie", "cinema", "concert", "games"),
    "health": ("medicine", "gamot", "mercury", "doctor", "clinic", "pharmacy"),
    "personal": ("haircut", "barber", "salon", "spa"),
    "gifts": ("gift", "regalo", "padala"),
    "fees": ("fee", "charge"),
    "salary": ("salary", "sweldo", "payroll", "pay"),
    "freelance": ("freelance", "client", "side", "raket"),
    "interest": ("interest",),
    "other-in": ("refund", "cashback", "bonus"),
}


def seed_default_categories(ctx: Ctx) -> None:
    """Create the user's default categories (ids derived from the slug, as
    the device mints them) unless they exist already, live or deleted: a
    default the user deleted is not brought back. Called when sign-up
    completes, so the first ``/sync/pull`` already carries them; finance's
    own first-touch bootstrap seeds the same rows and skips existing ones."""
    repo.seed_categories(ctx)


def default_account(ctx: Ctx) -> Account | None:
    """Settings' default account, else the last used, else the first cash."""
    st = repo.settings_row(ctx)
    for aid in (st.default_account_id, st.last_account_id):
        if aid:
            acc = owned_repo.get(ctx, Account, aid)
            if acc is not None and not acc.archived:
                return acc
    live = owned_repo.list_rows(
        ctx,
        Account,
        col(Account.archived).is_(False),
        order_by=[col(Account.sort_order)],
    )
    return next((a for a in live if a.type == "cash"), live[0] if live else None)


def resolve_category(
    ctx: Ctx, hint: str, *, kind: Literal["expense", "income"] = "expense"
) -> Category | None:
    """Match a free-text hint ("grab", "food", "sweldo") to a category: an
    exact name, then a known word for a seeded category, then the category
    last used with a payee starting with the hint."""
    h = " ".join(hint.lower().split())
    if not h:
        return None
    repo.settings_row(ctx)
    cats = owned_repo.list_rows(
        ctx, Category, col(Category.kind) == kind, col(Category.archived).is_(False)
    )
    for c in cats:
        if c.name.lower() == h or (c.slug and c.slug == h):
            return c
    by_slug = {c.slug: c for c in cats if c.slug}
    for slug, words in CATEGORY_WORDS.items():
        if slug in by_slug and any(re.search(rf"\b{re.escape(w)}\b", h) for w in words):
            return by_slug[slug]
    for c in cats:
        if h in c.name.lower():
            return c
    s = repo.load_state(ctx)
    cid = calc.suggest_category(s, h)
    if cid:
        hit = next((c for c in cats if str(c.id) == cid), None)
        if hit is not None:
            return hit
    return None


def _account_or_default(
    ctx: Ctx, account_id: uuid.UUID | None, *, for_income: bool
) -> uuid.UUID:
    return account_id or services.default_account_id(ctx, for_income=for_income)


def log_expense(
    ctx: Ctx,
    *,
    amount_minor: int,
    category_id: uuid.UUID | None = None,
    account_id: uuid.UUID | None = None,
    payee: str | None = None,
    note: str | None = None,
    source: RecordSource = "chat",
    at: datetime | None = None,
    receipt_media_id: uuid.UUID | None = None,
    record_id: uuid.UUID | None = None,
    pending: bool = False,
) -> FinRecord:
    return services._add_record(
        ctx,
        record_id=record_id,
        type="expense",
        amount_minor=amount_minor,
        account_id=_account_or_default(ctx, account_id, for_income=False),
        category_id=category_id,
        at=at,
        payee=payee,
        note=note,
        source=source,
        status="pending" if pending else "cleared",
        receipt_media_id=receipt_media_id,
    )[0]


def log_income(
    ctx: Ctx,
    *,
    amount_minor: int,
    category_id: uuid.UUID | None = None,
    account_id: uuid.UUID | None = None,
    payee: str | None = None,
    source: RecordSource = "chat",
    at: datetime | None = None,
    record_id: uuid.UUID | None = None,
    is_refund: bool = False,
    note: str | None = None,
) -> FinRecord:
    if category_id is None and not is_refund:
        other = repo.category_by_slug(ctx, "other-in")
        category_id = other.id if other else None
    return services._add_record(
        ctx,
        record_id=record_id,
        type="income",
        amount_minor=amount_minor,
        account_id=_account_or_default(ctx, account_id, for_income=True),
        category_id=category_id,
        at=at,
        payee=payee,
        note=note,
        source=source,
        is_refund=is_refund,
    )[0]


def log_transfer(
    ctx: Ctx,
    *,
    amount_minor: int,
    from_account_id: uuid.UUID,
    to_account_id: uuid.UUID,
    fee_minor: int = 0,
    source: RecordSource = "chat",
    at: datetime | None = None,
    record_id: uuid.UUID | None = None,
    note: str | None = None,
) -> list[FinRecord]:
    """Returns the transfer and, when ``fee_minor`` > 0, its fee expense."""
    return services._add_record(
        ctx,
        record_id=record_id,
        type="transfer",
        amount_minor=amount_minor,
        account_id=from_account_id,
        to_account_id=to_account_id,
        at=at,
        note=note,
        source=source,
        fee_minor=fee_minor,
    )


def add_planned(
    ctx: Ctx,
    *,
    name: str,
    amount_minor: int,
    day: date,
    account_id: uuid.UUID | None = None,
    category_id: uuid.UUID | None = None,
    type: Literal["expense", "income"] = "expense",
    planned_id: uuid.UUID | None = None,
    repeat: Literal["once", "monthly"] = "once",
) -> PlannedItem:
    """A planned item starting on ``day``: one-off, or monthly on that day of
    the month (chat: "netflix 549 every 5th" is monthly, as in the
    prototype's capture engine)."""
    data = S.PlannedCreate(
        id=planned_id,
        name=name,
        type=type,
        amount_minor=amount_minor,
        account_id=_account_or_default(ctx, account_id, for_income=type == "income"),
        category_id=category_id,
        schedule=(
            S.MonthlySchedule(kind="monthly", day=day.day)
            if repeat == "monthly"
            else S.OnceSchedule(kind="once", date=day)
        ),
        start=day,
    )
    values = services._planned_values(data)
    p, _ = owned_repo.upsert(ctx, PlannedItem, data.id or uuid.uuid4(), values)
    services._check_planned(ctx, p)
    services._dirty(ctx, day)
    return p


def find_account(ctx: Ctx, hint: str) -> Account | None:
    """An account by name ("gcash", "bpi card", "cash")."""
    h = " ".join(hint.lower().split())
    if not h:
        return None
    live = owned_repo.list_rows(
        ctx,
        Account,
        col(Account.archived).is_(False),
        order_by=[col(Account.sort_order)],
    )
    for test in (
        lambda a: a.name.lower() == h,
        lambda a: a.name.lower().startswith(h),
        lambda a: h in a.name.lower(),
        lambda a: all(w in a.name.lower() for w in h.split()),
        lambda a: a.type == h
        or (h in ("card", "credit card", "cc") and a.type == "credit"),
    ):
        hit = next((a for a in live if test(a)), None)
        if hit is not None:
            return hit
    return None


def delete_records(ctx: Ctx, *, record_ids: list[uuid.UUID]) -> None:
    services._delete_records(ctx, record_ids)


def restore_records(ctx: Ctx, *, record_ids: list[uuid.UUID]) -> None:
    services._restore_records(ctx, record_ids)


def delete_planned(ctx: Ctx, *, planned_id: uuid.UUID) -> None:
    """Undo of ``add_planned`` from chat: tombstones the item (refused, like
    the REST delete, once an occurrence has been paid)."""
    p = services._planned(ctx, planned_id)
    if owned_repo.count_rows(ctx, FinRecord, col(FinRecord.planned_id) == p.id):
        raise conflict(
            "planned_has_records", "It has paid occurrences — archive it instead"
        )
    owned_repo.soft_delete(ctx, p)


def spend_between(ctx: Ctx, first: date, last: date) -> int:
    """Total spend (expenses minus refunds, no transfers/adjustments) over
    the business days ``[first, last]``."""
    lo, hi = ctx.clock.window(first, last)
    signed = case(
        (col(FinRecord.type) == "expense", col(FinRecord.amount_minor)),
        else_=-col(FinRecord.amount_minor),
    )
    q = select(func.coalesce(func.sum(signed), 0)).where(
        col(FinRecord.owner_id) == ctx.user_id,
        col(FinRecord.tenant_id) == ctx.tenant_id,
        col(FinRecord.deleted_at).is_(None),
        col(FinRecord.is_adjustment).is_(False),
        or_(
            col(FinRecord.type) == "expense",
            and_(col(FinRecord.type) == "income", col(FinRecord.is_refund).is_(True)),
        ),
        col(FinRecord.at) >= lo,
        col(FinRecord.at) < hi,
    )
    return int(ctx.session.exec(q).one())


def advisor_answer(
    ctx: Ctx, text: str, *, scope: Literal["aggregates", "records"] = "aggregates"
) -> dict[str, Any]:
    """The deterministic advisor answer for a question (the companion's
    fallback when no model answers)."""
    st = repo.settings_row(ctx)
    s = repo.load_state(ctx, st)
    return advisor.answer(
        s,
        advisor.advisor_question(text),
        scope=scope,
        safety_floor_minor=st.safety_floor_minor,
    )


def list_accounts(ctx: Ctx) -> list[Account]:
    """Every account, archived included, in the user's order."""
    return owned_repo.list_rows(ctx, Account, order_by=[col(Account.sort_order)])


def list_categories(ctx: Ctx) -> list[Category]:
    """The non-archived categories (both kinds) in the user's order."""
    return owned_repo.list_rows(
        ctx,
        Category,
        col(Category.archived).is_(False),
        order_by=[col(Category.sort_order)],
    )


def expense_category_counts(ctx: Ctx, *, since: datetime) -> dict[uuid.UUID, int]:
    """How many categorised, non-adjustment expenses each category had after
    ``since``. Keys are in order of each category's first expense in the
    window, so ties keep a stable order."""
    counts: dict[uuid.UUID, int] = {}
    for cid in ctx.session.exec(
        select(FinRecord.category_id)
        .where(
            FinRecord.owner_id == ctx.user_id,
            FinRecord.tenant_id == ctx.tenant_id,
            col(FinRecord.deleted_at).is_(None),
            FinRecord.type == "expense",
            col(FinRecord.is_adjustment).is_(False),
            col(FinRecord.category_id).is_not(None),
            col(FinRecord.at) > since,
        )
        .order_by(col(FinRecord.at))
    ).all():
        if cid is not None:
            counts[cid] = counts.get(cid, 0) + 1
    return counts


def find_duplicate_expense(
    ctx: Ctx, *, amount_minor: int, at: datetime
) -> tuple[datetime, str | None] | None:
    """The earliest live expense of exactly ``amount_minor`` strictly within
    a day either side of ``at``: its time and payee."""
    row = ctx.session.exec(
        select(FinRecord.at, FinRecord.payee)
        .where(
            FinRecord.owner_id == ctx.user_id,
            FinRecord.tenant_id == ctx.tenant_id,
            col(FinRecord.deleted_at).is_(None),
            FinRecord.type == "expense",
            FinRecord.amount_minor == amount_minor,
            col(FinRecord.at) > at - timedelta(days=1),
            col(FinRecord.at) < at + timedelta(days=1),
        )
        .order_by(col(FinRecord.at))
        .limit(1)
    ).first()
    return (row[0], row[1]) if row else None


def budget_left(ctx: Ctx, *, category_id: str) -> tuple[str, int] | None:
    """This month's first non-archived budget covering ``category_id`` (or
    its parent): its name and what is left in centavos (negative when
    over). None when no budget covers it."""
    s = repo.load_state(ctx)
    cats = calc.cat_map(s)
    parent = cats[category_id].parent_id if category_id in cats else None
    b = next(
        (
            x
            for x in s.budgets
            if not x.archived
            and x.category_ids
            and (category_id in x.category_ids or (parent and parent in x.category_ids))
        ),
        None,
    )
    if b is None:
        return None
    v = calc.budget_view(s, b)
    return b.name, v.limit - v.spent


def load_state(ctx: Ctx) -> calc.State:
    """The user's whole finance state: the input to every ``calc``
    calculation."""
    return repo.load_state(ctx)


def start_statement_import(
    ctx: Ctx,
    *,
    account_id: uuid.UUID,
    file_name: str,
    file_type: str,
    media_id: uuid.UUID | None,
    import_id: uuid.UUID,
    rows: list[dict[str, Any]] | None = None,
) -> uuid.UUID:
    """Start a statement import for review, with the rows already read from
    it when given. Replay-safe: an existing ``import_id`` is returned as
    is. Flushes only, like every function here."""
    was = ctx.in_batch
    ctx.in_batch = True  # the import use cases end in ctx.commit()
    try:
        existing = owned_repo.get(ctx, StatementImport, import_id)
        if existing is not None:
            return existing.id
        imp = imports.start_import(
            ctx,
            data=S.ImportStart.model_validate(
                {
                    "id": import_id,
                    "account_id": account_id,
                    "file_name": file_name[:255] or "statement",
                    "file_type": file_type,
                    "file_media_id": media_id,
                }
            ),
        )
        if rows:
            imports.ingest_rows(
                ctx,
                import_id=imp.id,
                data=S.ExtractedIn.model_validate({"rows": rows}),
            )
        return imp.id
    finally:
        ctx.in_batch = was


def create_account(
    ctx: Ctx,
    *,
    name: str,
    type: S.AccountType,
    opening_minor: int = 0,
    limit_minor: int | None = None,
    account_id: uuid.UUID | None = None,
) -> Account:
    """A new account opening today (the first one becomes the default), as
    the Accounts screen's add does."""
    return services._add_account(
        ctx,
        data=S.AccountCreate(
            id=account_id,
            name=name,
            type=type,
            opening_minor=opening_minor,
            limit_minor=limit_minor,
        ),
    )


def delete_account(ctx: Ctx, *, account_id: uuid.UUID) -> None:
    """Undo of ``create_account`` from chat: refused (409) once the account
    has records. Settings stop pointing at it."""
    services._delete_account(ctx, account_id)
    st = repo.settings_row(ctx)
    if account_id in (st.default_account_id, st.last_account_id):
        if st.default_account_id == account_id:
            st.default_account_id = None
        if st.last_account_id == account_id:
            st.last_account_id = None
        ctx.session.add(st)


def create_budget(
    ctx: Ctx,
    *,
    name: str,
    limit_minor: int,
    category_ids: list[uuid.UUID],
    budget_id: uuid.UUID | None = None,
) -> Budget:
    """A monthly budget from this month on, over ``category_ids`` (empty:
    every expense category)."""
    return services._add_budget(
        ctx,
        data=S.BudgetCreate(
            id=budget_id, name=name, limit_minor=limit_minor, category_ids=category_ids
        ),
    )


def delete_budget(ctx: Ctx, *, budget_id: uuid.UUID) -> None:
    services._delete_budget(ctx, budget_id)


def find_budget(ctx: Ctx, name: str) -> Budget | None:
    """A live budget with this name (case-insensitive), if any."""
    n = name.strip().lower()
    return next(
        (b for b in owned_repo.list_rows(ctx, Budget) if b.name.lower() == n), None
    )
