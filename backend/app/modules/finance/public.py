"""Cross-module contract of the finance module (implemented by finance).

Amounts are integer centavos. These functions only flush: the calling use
case (the capture or companion module) commits.
"""

import re
import uuid
from datetime import date, datetime
from typing import Any, Literal

from sqlalchemy import and_, case, func, or_
from sqlmodel import col, select

from app.modules.finance import advisor, calc, repo, services
from app.modules.finance import schema as S
from app.modules.finance.models import Account, Category, FinRecord, PlannedItem
from app.shared import owned_repo
from app.shared.context import Ctx
from app.shared.domain import conflict

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
