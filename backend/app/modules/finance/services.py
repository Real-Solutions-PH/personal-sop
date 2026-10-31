"""Finance use cases (prototype ``finance/actions.ts``) and screen views.

One use case per function, keyword-only ``ctx``, ending with
``ctx.commit()``. Helpers prefixed ``_`` and everything in ``repo`` only
flush, so ``public.py`` can compose them inside another module's use case.
"""

import csv
import io
import uuid
from datetime import date, datetime, timedelta
from decimal import Decimal
from typing import Any

from sqlalchemy import or_, update
from sqlmodel import col

from app.modules.finance import calc, fx, repo
from app.modules.finance import schema as S
from app.modules.finance.models import (
    Account,
    AdvisorMessage,
    AdvisorThread,
    Budget,
    BudgetCategory,
    Category,
    FinanceSettings,
    FinRecord,
    ImportRow,
    LookBack,
    PlannedItem,
    PlannedSkip,
    PlannedSnooze,
    StatementImport,
)
from app.modules.stats.public import mark_dirty
from app.shared import owned_repo
from app.shared.context import Ctx
from app.shared.currency import strip_money_marks
from app.shared.domain import conflict, invalid, not_found
from app.shared.ids import derived_id
from app.shared.money import MAX_MINOR
from app.shared.owned import OwnedRow

MODULE = "finance"
r2 = calc.js_round


def _dirty(ctx: Ctx, *days: date | None) -> None:
    for d in {d for d in days if d is not None}:
        mark_dirty(ctx, module=MODULE, day=d)


def _day(ctx: Ctx, at: datetime) -> date:
    return ctx.clock.day_of(at)


# ---------------------------------------------------------------------------
# Lookups and validation
# ---------------------------------------------------------------------------


def _account(ctx: Ctx, account_id: uuid.UUID) -> Account:
    return owned_repo.require(ctx, Account, account_id, what="account")


def _category(ctx: Ctx, category_id: uuid.UUID) -> Category:
    return owned_repo.require(ctx, Category, category_id, what="category")


def _record(
    ctx: Ctx, record_id: uuid.UUID, *, include_deleted: bool = False
) -> FinRecord:
    return owned_repo.require(
        ctx, FinRecord, record_id, what="record", include_deleted=include_deleted
    )


def _planned(ctx: Ctx, planned_id: uuid.UUID) -> PlannedItem:
    return owned_repo.require(ctx, PlannedItem, planned_id, what="planned_item")


def _check_record(
    ctx: Ctx,
    *,
    type: str,
    account_id: uuid.UUID,
    to_account_id: uuid.UUID | None,
    category_id: uuid.UUID | None,
    is_refund: bool,
    is_adjustment: bool = False,
) -> None:
    _account(ctx, account_id)
    if type == "transfer":
        if to_account_id is None:
            raise invalid("transfer_needs_to_account", "Pick the account it goes to")
        if to_account_id == account_id:
            raise invalid("transfer_same_account", "Pick two different accounts")
        _account(ctx, to_account_id)
        if category_id is not None:
            raise invalid("transfer_has_category", "A transfer has no category")
        if is_refund:
            raise invalid("transfer_refund", "A transfer cannot be a refund")
        return
    if to_account_id is not None:
        raise invalid("to_account_on_flow", "Only a transfer has a second account")
    if category_id is None or is_adjustment:
        if category_id is not None:
            _category(ctx, category_id)
        return
    cat = _category(ctx, category_id)
    # A refund is income booked in the original EXPENSE category.
    want = "expense" if type == "expense" or is_refund else "income"
    if cat.kind != want:
        raise invalid("category_kind_mismatch", "That category is for the other kind")
    if is_refund and type != "income":
        raise invalid("refund_not_income", "A refund is money coming back in")


def _settings(ctx: Ctx) -> FinanceSettings:
    return repo.settings_row(ctx)


def _remember_last(ctx: Ctx, rec: FinRecord) -> None:
    st = _settings(ctx)
    if rec.type != "transfer":
        st.last_account_id = rec.account_id
    if rec.type == "expense" and rec.category_id and not rec.is_adjustment:
        st.last_category_id = rec.category_id
    ctx.session.add(st)


# ---------------------------------------------------------------------------
# Records
# ---------------------------------------------------------------------------


def _put_record(ctx: Ctx, row_id: uuid.UUID, values: dict[str, Any]) -> FinRecord:
    """Insert (or idempotently replay) a record by its client-minted id."""
    rec, _ = owned_repo.upsert(ctx, FinRecord, row_id, values)
    _dirty(ctx, _day(ctx, rec.at))
    return rec


def _add_record(
    ctx: Ctx,
    *,
    record_id: uuid.UUID | None,
    type: str,
    amount_minor: int,
    account_id: uuid.UUID,
    to_account_id: uuid.UUID | None = None,
    category_id: uuid.UUID | None = None,
    at: datetime | None = None,
    payee: str | None = None,
    note: str | None = None,
    source: str = "manual",
    status: str = "cleared",
    is_refund: bool = False,
    receipt_media_id: uuid.UUID | None = None,
    fee_minor: int = 0,
    planned_id: uuid.UUID | None = None,
    planned_on: date | None = None,
) -> list[FinRecord]:
    _check_record(
        ctx,
        type=type,
        account_id=account_id,
        to_account_id=to_account_id,
        category_id=category_id,
        is_refund=is_refund,
    )
    if not 1 <= amount_minor <= MAX_MINOR or not 0 <= fee_minor <= MAX_MINOR:
        raise invalid("amount_out_of_range", "That amount is out of range")
    if fee_minor and type != "transfer":
        raise invalid("fee_on_flow", "Only a transfer has a fee")
    rid = record_id or uuid.uuid4()
    when = at or ctx.now
    rec = _put_record(
        ctx,
        rid,
        {
            "type": type,
            "amount_minor": amount_minor,
            "account_id": account_id,
            "to_account_id": to_account_id,
            "category_id": category_id,
            "at": when,
            "payee": payee,
            "note": note,
            "source": source,
            "status": status,
            "is_refund": is_refund,
            "receipt_media_id": receipt_media_id,
            "planned_id": planned_id,
            "planned_on": planned_on,
        },
    )
    out = [rec]
    if fee_minor:
        fees = repo.category_by_slug(ctx, "fees")
        out.append(
            _put_record(
                ctx,
                derived_id("transfer-fee", rid, "fee"),
                {
                    "type": "expense",
                    "amount_minor": fee_minor,
                    "account_id": account_id,
                    "category_id": fees.id if fees else None,
                    "payee": "Transfer fee",
                    "fee_of": rid,
                    "at": when,
                    "source": source,
                    "status": "cleared",
                },
            )
        )
    _remember_last(ctx, rec)
    return out


FX_FIELDS = ("orig_currency", "orig_amount_minor", "fx_rate")
FX_FIELDS_SET = frozenset(FX_FIELDS)


def fx_values(
    ctx: Ctx,
    orig_currency: str | None,
    orig_amount_minor: int | None,
    fx_rate: Decimal | None,
) -> tuple[dict[str, Any], int | None]:
    """A record kept in another currency: its three fx fields and its amount
    in the user's currency (``None`` when it is in the user's currency, and
    the fields are cleared). The rate is the device's when it sent one (it
    came from :func:`fx_rate_for`), else the latest."""
    cleared: dict[str, Any] = dict.fromkeys(FX_FIELDS)
    if orig_currency is None or orig_currency == ctx.currency.code:
        return cleared, None
    if orig_amount_minor is None:
        raise invalid("orig_amount_required", "Enter the amount as spent")
    rate = fx_rate
    if rate is None:
        rate = fx_rate_for(ctx, orig_currency).rate
    amount = fx.convert_minor(orig_amount_minor, rate)
    if not 1 <= amount <= MAX_MINOR:
        raise invalid("amount_out_of_range", "That amount is out of range")
    return {
        "orig_currency": orig_currency,
        "orig_amount_minor": orig_amount_minor,
        "fx_rate": rate,
    }, amount


def fx_rate_for(ctx: Ctx, base: str) -> fx.Rate:
    """The latest rate from ``base`` to the user's currency (422
    ``fx_unavailable`` when it can't be had: the person can still enter the
    amount in their own currency)."""
    try:
        return fx.latest(base, ctx.currency.code)
    except fx.FxError as exc:
        raise invalid(
            "fx_unavailable" if exc.code != "fx_unknown_currency" else exc.code,
            "Couldn't get the exchange rate — enter the amount in your currency",
        ) from None


def add_record(ctx: Ctx, *, data: S.RecordCreate) -> list[FinRecord]:
    """FIN-04 save: an expense, income or transfer (plus its fee)."""
    fx_fields, converted = fx_values(
        ctx, data.orig_currency, data.orig_amount_minor, data.fx_rate
    )
    out = _add_record(
        ctx,
        record_id=data.id,
        type=data.type,
        amount_minor=converted or data.amount_minor,
        account_id=data.account_id,
        to_account_id=data.to_account_id,
        category_id=data.category_id,
        at=data.at,
        payee=data.payee,
        note=data.note,
        source=data.source or "manual",
        status=data.status or "cleared",
        is_refund=bool(data.is_refund),
        receipt_media_id=data.receipt_media_id,
        fee_minor=data.fee_minor,
    )
    if converted is not None:
        owned_repo.apply(out[0], fx_fields)
        ctx.session.add(out[0])
        ctx.session.flush()
    ctx.commit()
    return out


def default_account_id(ctx: Ctx, *, for_income: bool = False) -> uuid.UUID:
    """Prototype order: an expense goes to the last-used account, then the
    default; income goes to the default. Falls back to the first account."""
    st = _settings(ctx)
    order = (
        [st.default_account_id]
        if for_income
        else [st.last_account_id, st.default_account_id]
    )
    for aid in order:
        if aid and owned_repo.get(ctx, Account, aid) is not None:
            return aid
    first = owned_repo.find_one(ctx, Account, col(Account.archived).is_(False))
    if first is None:
        raise invalid("no_account", "Add an account first")
    return first.id


def update_record(ctx: Ctx, *, record_id: uuid.UUID, data: S.RecordUpdate) -> FinRecord:
    rec = _update_record(ctx, record_id, data)
    ctx.commit()
    return rec


def _update_record(ctx: Ctx, record_id: uuid.UUID, data: S.RecordUpdate) -> FinRecord:
    """Edit one record (flush only; the caller commits)."""
    rec = _record(ctx, record_id)
    patch = data.model_dump(exclude_unset=True)
    if rec.is_adjustment and {"type", "account_id", "to_account_id"} & patch.keys():
        raise invalid("adjustment_locked", "Delete the adjustment and adjust again")
    merged: dict[str, Any] = {
        "type": rec.type,
        "account_id": rec.account_id,
        "to_account_id": rec.to_account_id,
        "category_id": rec.category_id,
        "is_refund": rec.is_refund,
    } | {
        k: v
        for k, v in patch.items()
        if k in {"type", "account_id", "to_account_id", "category_id", "is_refund"}
    }
    if merged["type"] != "transfer" and "to_account_id" not in patch:
        merged["to_account_id"] = None
        patch["to_account_id"] = None
    if merged["type"] == "transfer" and "category_id" not in patch:
        merged["category_id"] = None
        patch["category_id"] = None
    _check_record(
        ctx,
        type=str(merged["type"]),
        account_id=merged["account_id"],
        to_account_id=merged["to_account_id"],
        category_id=merged["category_id"],
        is_refund=bool(merged["is_refund"]),
        is_adjustment=rec.is_adjustment,
    )
    if FX_FIELDS_SET & patch.keys():
        fx_fields, converted = fx_values(
            ctx,
            patch.get("orig_currency", rec.orig_currency),
            patch.get("orig_amount_minor", rec.orig_amount_minor),
            patch.get("fx_rate", rec.fx_rate),
        )
        patch |= fx_fields
        if converted is not None:
            patch["amount_minor"] = converted
    old_day = _day(ctx, rec.at)
    owned_repo.apply(rec, patch)
    rec.edited_at = ctx.now
    ctx.session.add(rec)
    ctx.session.flush()
    _dirty(ctx, old_day, _day(ctx, rec.at))
    return rec


def _delete_records(ctx: Ctx, ids: list[uuid.UUID]) -> list[uuid.UUID]:
    """Tombstone records and the fees attached to them. Returns every id."""
    recs = [_record(ctx, i) for i in dict.fromkeys(ids)]
    fees = owned_repo.list_rows(
        ctx, FinRecord, col(FinRecord.fee_of).in_([r.id for r in recs])
    )
    gone: list[uuid.UUID] = []
    for r in [*recs, *fees]:
        if r.id in gone:
            continue
        owned_repo.soft_delete(ctx, r)
        _dirty(ctx, _day(ctx, r.at))
        gone.append(r.id)
    return gone


def delete_records(ctx: Ctx, *, record_ids: list[uuid.UUID]) -> list[uuid.UUID]:
    gone = _delete_records(ctx, record_ids)
    ctx.commit()
    return gone


def delete_record(ctx: Ctx, record_id: uuid.UUID) -> None:
    """Sync delete hook: a record's fee goes with it."""
    _delete_records(ctx, [record_id])
    ctx.commit()


def _restore_records(ctx: Ctx, ids: list[uuid.UUID]) -> list[uuid.UUID]:
    recs = [_record(ctx, i, include_deleted=True) for i in dict.fromkeys(ids)]
    fees = owned_repo.list_rows(
        ctx,
        FinRecord,
        col(FinRecord.fee_of).in_([r.id for r in recs]),
        col(FinRecord.deleted_at).is_not(None),
        include_deleted=True,
    )
    back: list[uuid.UUID] = []
    for r in [*recs, *fees]:
        if r.deleted_at is None or r.id in back:
            continue
        owned_repo.restore(ctx, r)
        _dirty(ctx, _day(ctx, r.at))
        back.append(r.id)
    return back


def restore_records(ctx: Ctx, *, record_ids: list[uuid.UUID]) -> list[uuid.UUID]:
    back = _restore_records(ctx, record_ids)
    ctx.commit()
    return back


def _recategorise(
    ctx: Ctx, ids: list[uuid.UUID], category_id: uuid.UUID
) -> list[FinRecord]:
    cat = _category(ctx, category_id)
    out = []
    for i in dict.fromkeys(ids):
        rec = _record(ctx, i)
        if rec.type == "transfer":
            raise invalid("transfer_has_category", "A transfer has no category")
        want = "expense" if rec.type == "expense" or rec.is_refund else "income"
        if cat.kind != want and not rec.is_adjustment:
            raise invalid(
                "category_kind_mismatch", "That category is for the other kind"
            )
        rec.category_id = cat.id
        rec.edited_at = ctx.now
        ctx.session.add(rec)
        _dirty(ctx, _day(ctx, rec.at))
        out.append(rec)
    ctx.session.flush()
    return out


def recategorise(
    ctx: Ctx, *, record_ids: list[uuid.UUID], category_id: uuid.UUID
) -> list[FinRecord]:
    out = _recategorise(ctx, record_ids, category_id)
    ctx.commit()
    return out


def duplicate_record(
    ctx: Ctx, *, record_id: uuid.UUID, new_id: uuid.UUID | None = None
) -> FinRecord:
    """A copy dated now, detached from any import or planned item."""
    src = _record(ctx, record_id)
    if src.is_adjustment:
        raise invalid("adjustment_duplicate", "Adjust the balance instead")
    out = _add_record(
        ctx,
        record_id=new_id,
        type=src.type,
        amount_minor=src.amount_minor,
        account_id=src.account_id,
        to_account_id=src.to_account_id,
        category_id=src.category_id,
        payee=src.payee,
        note=src.note,
        is_refund=src.is_refund,
        source="manual",
    )
    ctx.commit()
    return out[0]


def _confirm(ctx: Ctx, record_id: uuid.UUID) -> FinRecord:
    rec = _record(ctx, record_id)
    rec.status = "cleared"
    rec.edited_at = ctx.now
    ctx.session.add(rec)
    ctx.session.flush()
    _dirty(ctx, _day(ctx, rec.at))
    return rec


def confirm_record(ctx: Ctx, *, record_id: uuid.UUID) -> FinRecord:
    rec = _confirm(ctx, record_id)
    ctx.commit()
    return rec


def _record_query_filters(ctx: Ctx, f: S.RecordFilter) -> list[Any]:
    w: list[Any] = []
    if f.type:
        w.append(FinRecord.type == f.type)
    if f.account_ids:
        w.append(
            or_(
                col(FinRecord.account_id).in_(f.account_ids),
                col(FinRecord.to_account_id).in_(f.account_ids),
            )
        )
    if f.category_ids:
        kids = owned_repo.list_rows(
            ctx, Category, col(Category.parent_id).in_(f.category_ids)
        )
        w.append(
            col(FinRecord.category_id).in_([*f.category_ids, *(c.id for c in kids)])
        )
    if f.first or f.last:
        first = f.first or date(1970, 1, 1)
        last = f.last or date(9998, 12, 31)
        if last < first:
            raise invalid("bad_range", "The range ends before it starts")
        lo, hi = ctx.clock.window(first, last)
        w += [col(FinRecord.at) >= lo, col(FinRecord.at) < hi]
    if f.min_minor is not None:
        w.append(col(FinRecord.amount_minor) >= f.min_minor)
    if f.max_minor is not None:
        w.append(col(FinRecord.amount_minor) <= f.max_minor)
    if f.sources:
        w.append(col(FinRecord.source).in_(f.sources))
    if f.pending_only:
        w.append(FinRecord.status == "pending")
    if f.planned_id:
        w.append(FinRecord.planned_id == f.planned_id)
    if f.import_id:
        w.append(FinRecord.import_id == f.import_id)
    if f.q and f.q.strip():
        q = f.q.strip()
        like = (
            "%" + q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"
        )
        terms: list[Any] = [
            col(FinRecord.payee).ilike(like, escape="\\"),
            col(FinRecord.note).ilike(like, escape="\\"),
        ]
        digits = strip_money_marks(q.upper()).replace(",", "").strip()
        try:
            terms.append(FinRecord.amount_minor == r2(float(digits) * 100))
        except ValueError:
            pass
        w.append(or_(*terms))
    return w


def list_records(
    ctx: Ctx, *, f: S.RecordFilter, skip: int, limit: int
) -> tuple[list[FinRecord], int]:
    where = _record_query_filters(ctx, f)
    orders: dict[str, list[Any]] = {
        "date": [col(FinRecord.at).desc(), col(FinRecord.id)],
        "amount": [col(FinRecord.amount_minor).desc(), col(FinRecord.at).desc()],
        "payee": [col(FinRecord.payee).asc(), col(FinRecord.at).desc()],
    }
    order = orders[f.sort]
    rows = owned_repo.list_rows(
        ctx, FinRecord, *where, order_by=order, skip=skip, limit=limit
    )
    return rows, owned_repo.count_rows(ctx, FinRecord, *where)


def record_public(ctx: Ctx, rec: FinRecord) -> S.RecordPublic:
    out = S.RecordPublic.model_validate(rec)
    out.day = _day(ctx, rec.at)
    return out


# ---------------------------------------------------------------------------
# Accounts
# ---------------------------------------------------------------------------


def _add_account(ctx: Ctx, *, data: S.AccountCreate) -> Account:
    _settings(ctx)
    values = data.model_dump(exclude_unset=True, exclude={"id"})
    values.setdefault("opening_date", ctx.today)
    values.setdefault("sort_order", owned_repo.count_rows(ctx, Account))
    if values.get("limit_minor") is not None and data.type != "credit":
        raise invalid("limit_not_credit", "Only a credit card has a limit")
    acc, _ = owned_repo.upsert(ctx, Account, data.id or uuid.uuid4(), values)
    st = _settings(ctx)
    if st.default_account_id is None:
        st.default_account_id = acc.id
        ctx.session.add(st)
    _dirty(ctx, ctx.today)
    return acc


def add_account(ctx: Ctx, *, data: S.AccountCreate) -> Account:
    acc = _add_account(ctx, data=data)
    ctx.commit()
    return acc


def update_account(
    ctx: Ctx, *, account_id: uuid.UUID, data: S.AccountFields
) -> Account:
    acc = _update_account(ctx, account_id, data)
    ctx.commit()
    return acc


def _update_account(ctx: Ctx, account_id: uuid.UUID, data: S.AccountFields) -> Account:
    """Edit one account (flush only; the caller commits)."""
    acc = _account(ctx, account_id)
    patch = data.model_dump(exclude_unset=True)
    for key in ("name", "type", "opening_minor", "opening_date"):
        if key in patch and patch[key] is None:
            raise invalid("field_required", "That field cannot be empty")
    owned_repo.apply(acc, patch)
    if acc.limit_minor is not None and acc.type != "credit":
        raise invalid("limit_not_credit", "Only a credit card has a limit")
    ctx.session.add(acc)
    ctx.session.flush()
    _dirty(ctx, ctx.today)
    return acc


def _delete_account(ctx: Ctx, account_id: uuid.UUID) -> None:
    """Only an account with no records can be deleted; archive the rest."""
    acc = _account(ctx, account_id)
    used = owned_repo.count_rows(
        ctx,
        FinRecord,
        or_(
            col(FinRecord.account_id) == acc.id, col(FinRecord.to_account_id) == acc.id
        ),
    )
    if used:
        raise conflict(
            "account_has_records", "This account has records — archive it instead"
        )
    owned_repo.soft_delete(ctx, acc)


def delete_account(ctx: Ctx, *, account_id: uuid.UUID) -> None:
    _delete_account(ctx, account_id)
    ctx.commit()


def _adjust(
    ctx: Ctx,
    account_id: uuid.UUID,
    actual_minor: int,
    note: str | None,
    record_id: uuid.UUID | None,
) -> FinRecord | None:
    acc = _account(ctx, account_id)
    state = repo.load_state(ctx)
    current = calc.balance_of(state, repo.acct_of(acc))
    diff = actual_minor - current
    if not diff:
        return None
    adj = repo.category_by_slug(ctx, "adjust")
    rec = _put_record(
        ctx,
        record_id or uuid.uuid4(),
        {
            "type": "income" if diff > 0 else "expense",
            "amount_minor": abs(diff),
            "account_id": acc.id,
            "category_id": adj.id if adj else None,
            "payee": "Market value update" if acc.manual else "Balance adjustment",
            "note": note,
            "is_adjustment": True,
            "source": "adjustment",
            "at": ctx.now,
            "status": "cleared",
        },
    )
    return rec


def adjust_balance(
    ctx: Ctx,
    *,
    account_id: uuid.UUID,
    actual_minor: int,
    note: str | None = None,
    record_id: uuid.UUID | None = None,
) -> FinRecord | None:
    """FIN-12: log the difference to the actual balance as an adjustment
    record (excluded from income and spend). ``None`` when nothing differs."""
    rec = _adjust(ctx, account_id, actual_minor, note, record_id)
    ctx.commit()
    return rec


def account_views(ctx: Ctx, state: calc.State | None = None) -> list[S.AccountView]:
    s = state or repo.load_state(ctx)
    bal = calc.balances(s)
    rows = owned_repo.list_rows(
        ctx, Account, order_by=[col(Account.sort_order), col(Account.created_at)]
    )
    return [
        S.AccountView.model_validate(
            {
                **S.AccountPublic.model_validate(a).model_dump(),
                "balance_minor": bal.get(str(a.id), a.opening_minor),
                "reconciled_days_ago": (ctx.today - a.last_reconciled).days
                if a.last_reconciled
                else None,
            }
        )
        for a in rows
    ]


def accounts_view(ctx: Ctx) -> S.AccountsPublic:
    s = repo.load_state(ctx)
    views = account_views(ctx, s)
    out = S.AccountsPublic(
        data=views,
        count=len(views),
        net_worth_minor=calc.net_worth(s),
        liquid_minor=calc.liquid(s),
    )
    ctx.commit()
    return out


def account_detail(ctx: Ctx, *, account_id: uuid.UUID, days: int) -> S.AccountDetail:
    acc = _account(ctx, account_id)
    s = repo.load_state(ctx)
    view = next(v for v in account_views(ctx, s) if v.id == acc.id)
    out = S.AccountDetail(
        account=view, series_minor=calc.account_series(s, repo.acct_of(acc), days)
    )
    ctx.commit()
    return out


# ---------------------------------------------------------------------------
# Categories
# ---------------------------------------------------------------------------


def _check_parent(
    ctx: Ctx, cat_id: uuid.UUID, kind: str, parent_id: uuid.UUID | None
) -> None:
    if parent_id is None:
        return
    if parent_id == cat_id:
        raise invalid("category_self_parent", "A category cannot contain itself")
    parent = _category(ctx, parent_id)
    if parent.parent_id is not None:
        raise invalid("category_too_deep", "Categories nest one level only")
    if parent.kind != kind:
        raise invalid("category_kind_mismatch", "That category is for the other kind")
    if owned_repo.count_rows(ctx, Category, col(Category.parent_id) == cat_id):
        raise invalid("category_has_children", "Move its sub-categories out first")


def add_category(ctx: Ctx, *, data: S.CategoryCreate) -> Category:
    repo.settings_row(ctx)
    cid = data.id or uuid.uuid4()
    _check_parent(ctx, cid, data.kind, data.parent_id)
    values = data.model_dump(exclude_unset=True, exclude={"id"})
    values["system"] = False
    cat, _ = owned_repo.upsert(ctx, Category, cid, values)
    ctx.commit()
    return cat


def update_category(
    ctx: Ctx, *, category_id: uuid.UUID, data: S.CategoryFields
) -> Category:
    cat = _category(ctx, category_id)
    patch = data.model_dump(exclude_unset=True)
    if "name" in patch and patch["name"] is None:
        raise invalid("field_required", "That field cannot be empty")
    if cat.system and patch.get("kind", cat.kind) != cat.kind:
        raise invalid("category_system", "A built-in category keeps its kind")
    kind = patch.get("kind") or cat.kind
    if "parent_id" in patch or "kind" in patch:
        _check_parent(ctx, cat.id, kind, patch.get("parent_id", cat.parent_id))
    owned_repo.apply(cat, patch)
    ctx.session.add(cat)
    ctx.session.flush()
    _dirty(ctx, ctx.today)
    ctx.commit()
    return cat


def move_sub_category(
    ctx: Ctx, *, category_id: uuid.UUID, parent_id: uuid.UUID
) -> Category:
    """Move a sub-category under another parent of the same kind."""
    cat = _category(ctx, category_id)
    _check_parent(ctx, cat.id, cat.kind, parent_id)
    cat.parent_id = parent_id
    ctx.session.add(cat)
    ctx.session.flush()
    _dirty(ctx, ctx.today)
    ctx.commit()
    return cat


def category_uses(ctx: Ctx, *, category_id: uuid.UUID) -> S.CategoryUses:
    cat = _category(ctx, category_id)
    return S.CategoryUses(
        records=owned_repo.count_rows(
            ctx, FinRecord, col(FinRecord.category_id) == cat.id
        ),
        planned=owned_repo.count_rows(
            ctx, PlannedItem, col(PlannedItem.category_id) == cat.id
        ),
        budgets=owned_repo.count_rows(
            ctx, BudgetCategory, col(BudgetCategory.category_id) == cat.id
        ),
    )


def _bulk(ctx: Ctx, model: type[OwnedRow], *where: Any, **values: Any) -> None:
    ctx.session.exec(
        update(model)
        .where(
            col(model.owner_id) == ctx.user_id,
            col(model.tenant_id) == ctx.tenant_id,
            col(model.deleted_at).is_(None),
            *where,
        )
        .values(**values, updated_at=ctx.now)
        .execution_options(synchronize_session="fetch")
    )


def _delete_category(
    ctx: Ctx, category_id: uuid.UUID, move_to: uuid.UUID | None
) -> None:
    cat = _category(ctx, category_id)
    if cat.system:
        raise conflict("category_system", "Built-in categories cannot be deleted")
    if move_to is not None:
        target = _category(ctx, move_to)
        if target.id == cat.id:
            raise invalid("category_move_self", "Pick a different category")
        if target.kind != cat.kind:
            raise invalid(
                "category_kind_mismatch", "That category is for the other kind"
            )
        _bulk(
            ctx,
            FinRecord,
            col(FinRecord.category_id) == cat.id,
            category_id=target.id,
            edited_at=ctx.now,
        )
        _bulk(
            ctx,
            PlannedItem,
            col(PlannedItem.category_id) == cat.id,
            category_id=target.id,
        )
        for link in owned_repo.list_rows(
            ctx, BudgetCategory, col(BudgetCategory.category_id) == cat.id
        ):
            has_target = owned_repo.find_one(
                ctx,
                BudgetCategory,
                col(BudgetCategory.budget_id) == link.budget_id,
                col(BudgetCategory.category_id) == target.id,
            )
            if has_target is not None:
                owned_repo.soft_delete(ctx, link)
            else:
                link.category_id = target.id
                ctx.session.add(link)
    else:
        if owned_repo.count_rows(ctx, FinRecord, col(FinRecord.category_id) == cat.id):
            raise conflict(
                "category_in_use", "Move its records to another category first"
            )
        _bulk(
            ctx, PlannedItem, col(PlannedItem.category_id) == cat.id, category_id=None
        )
        for link in owned_repo.list_rows(
            ctx, BudgetCategory, col(BudgetCategory.category_id) == cat.id
        ):
            owned_repo.soft_delete(ctx, link)
    _bulk(ctx, Category, col(Category.parent_id) == cat.id, parent_id=None)
    st = _settings(ctx)
    if st.last_category_id == cat.id:
        st.last_category_id = move_to
        ctx.session.add(st)
    owned_repo.soft_delete(ctx, cat)
    _dirty(ctx, ctx.today)


def delete_category(
    ctx: Ctx, *, category_id: uuid.UUID, move_to: uuid.UUID | None = None
) -> None:
    """Delete a category, moving its records, planned items and budget scope
    to ``move_to``. Without a target it must be unused by records."""
    _delete_category(ctx, category_id, move_to)
    ctx.commit()


def list_categories(
    ctx: Ctx, *, kind: str | None, include_archived: bool, skip: int, limit: int
) -> tuple[list[Category], int]:
    repo.settings_row(ctx)
    where: list[Any] = []
    if kind:
        where.append(Category.kind == kind)
    if not include_archived:
        where.append(col(Category.archived).is_(False))
    rows = owned_repo.list_rows(
        ctx,
        Category,
        *where,
        order_by=[
            col(Category.sort_order),
            col(Category.created_at),
            col(Category.name),
        ],
        skip=skip,
        limit=limit,
    )
    count = owned_repo.count_rows(ctx, Category, *where)
    ctx.commit()
    return rows, count


# ---------------------------------------------------------------------------
# Budgets
# ---------------------------------------------------------------------------


def _set_budget_categories(ctx: Ctx, budget: Budget, ids: list[uuid.UUID]) -> None:
    wanted = list(dict.fromkeys(ids))
    for cid in wanted:
        if _category(ctx, cid).kind != "expense":
            raise invalid("category_kind_mismatch", "Budgets cover expense categories")
    current = owned_repo.list_rows(
        ctx, BudgetCategory, col(BudgetCategory.budget_id) == budget.id
    )
    for link in current:
        if link.category_id not in wanted:
            owned_repo.soft_delete(ctx, link)
    for cid in wanted:
        owned_repo.upsert(
            ctx,
            BudgetCategory,
            derived_id("budget-category", budget.id, str(cid)),
            {"budget_id": budget.id, "category_id": cid},
            natural_key=("budget_id", "category_id"),
        )


def _add_budget(ctx: Ctx, *, data: S.BudgetCreate) -> Budget:
    repo.settings_row(ctx)
    values = data.model_dump(exclude_unset=True, exclude={"id", "category_ids"})
    values.setdefault("start_date", ctx.today)
    b, _ = owned_repo.upsert(ctx, Budget, data.id or uuid.uuid4(), values)
    _set_budget_categories(ctx, b, data.category_ids or [])
    _dirty(ctx, ctx.today)
    return b


def add_budget(ctx: Ctx, *, data: S.BudgetCreate) -> Budget:
    b = _add_budget(ctx, data=data)
    ctx.commit()
    return b


def update_budget(ctx: Ctx, *, budget_id: uuid.UUID, data: S.BudgetFields) -> Budget:
    b = _update_budget(ctx, budget_id, data)
    ctx.commit()
    return b


def _update_budget(ctx: Ctx, budget_id: uuid.UUID, data: S.BudgetFields) -> Budget:
    """Edit one budget (flush only; the caller commits)."""
    b = owned_repo.require(ctx, Budget, budget_id, what="budget")
    patch = data.model_dump(exclude_unset=True, exclude={"category_ids"})
    for key in ("name", "limit_minor", "start_date"):
        if key in patch and patch[key] is None:
            raise invalid("field_required", "That field cannot be empty")
    owned_repo.apply(b, patch)
    ctx.session.add(b)
    if data.category_ids is not None:
        _set_budget_categories(ctx, b, data.category_ids)
    ctx.session.flush()
    _dirty(ctx, ctx.today)
    return b


def _delete_budget(ctx: Ctx, budget_id: uuid.UUID) -> None:
    b = owned_repo.require(ctx, Budget, budget_id, what="budget")
    for link in owned_repo.list_rows(
        ctx, BudgetCategory, col(BudgetCategory.budget_id) == b.id
    ):
        owned_repo.soft_delete(ctx, link)
    owned_repo.soft_delete(ctx, b)
    _dirty(ctx, ctx.today)


def delete_budget(ctx: Ctx, *, budget_id: uuid.UUID) -> None:
    _delete_budget(ctx, budget_id)
    ctx.commit()


def budget_public(
    ctx: Ctx, b: Budget, cat_ids: list[uuid.UUID] | None = None
) -> S.BudgetPublic:
    ids = (
        cat_ids if cat_ids is not None else repo.budget_category_ids(ctx, [b.id])[b.id]
    )
    return S.BudgetPublic(
        id=b.id,
        name=b.name,
        period=b.period,
        limit_minor=b.limit_minor,
        rollover=b.rollover,
        start_date=b.start_date,
        archived=b.archived,
        category_ids=ids,
        version=b.version,
    )


def _view_out(
    s: calc.State, v: calc.BudgetView, pub: S.BudgetPublic
) -> S.BudgetViewOut:
    spent_today = (
        calc.spend_in(s, s.today, s.today, v.budget.category_ids)
        if v.first <= s.today <= v.last
        else 0
    )
    return S.BudgetViewOut(
        budget=pub,
        month=v.month,
        first=v.first,
        last=v.last,
        spent_minor=v.spent,
        limit_minor=v.limit,
        carry_minor=v.carry,
        pct=v.pct,
        pace=v.pace,
        days_left=v.days_left,
        safe_per_day_minor=r2(v.safe_per_day),
        today_allowance_minor=r2(calc.today_allowance(v, spent_today)),
    )


def _budget_pubs(ctx: Ctx, rows: list[Budget]) -> dict[str, S.BudgetPublic]:
    links = repo.budget_category_ids(ctx, [b.id for b in rows])
    return {str(b.id): budget_public(ctx, b, links[b.id]) for b in rows}


def budgets_view(
    ctx: Ctx, *, include_archived: bool, month: str | None
) -> S.BudgetsPublic:
    s = repo.load_state(ctx)
    rows = owned_repo.list_rows(ctx, Budget, order_by=[col(Budget.created_at)])
    pubs = _budget_pubs(ctx, rows)
    out = [
        _view_out(s, calc.budget_view(s, b, month), pubs[b.id])
        for b in s.budgets
        if include_archived or not b.archived
    ]
    ctx.commit()
    return S.BudgetsPublic(data=out, count=len(out))


def budget_detail(ctx: Ctx, *, budget_id: uuid.UUID) -> S.BudgetDetail:
    b = owned_repo.require(ctx, Budget, budget_id, what="budget")
    s = repo.load_state(ctx)
    bud = next(x for x in s.budgets if x.id == str(b.id))
    pub = budget_public(ctx, b)
    mk = calc.month_of(s.today, s.settings.month_start_day)
    hist = [
        _view_out(s, calc.budget_view(s, bud, calc.add_months(mk, -i)), pub)
        for i in range(1, 7)
    ]
    out = S.BudgetDetail(
        view=_view_out(s, calc.budget_view(s, bud), pub),
        history=hist,
        avg3_minor=r2(calc.avg_spend(s, bud.category_ids)),
    )
    ctx.commit()
    return out


# ---------------------------------------------------------------------------
# Planned items
# ---------------------------------------------------------------------------


def _check_planned(ctx: Ctx, p: PlannedItem) -> None:
    _account(ctx, p.account_id)
    if p.type == "transfer":
        if p.to_account_id is None or p.to_account_id == p.account_id:
            raise invalid("transfer_needs_to_account", "Pick two different accounts")
        _account(ctx, p.to_account_id)
    elif p.to_account_id is not None:
        raise invalid("to_account_on_flow", "Only a transfer has a second account")
    if p.category_id is not None:
        cat = _category(ctx, p.category_id)
        if p.type != "transfer" and cat.kind != p.type:
            raise invalid(
                "category_kind_mismatch", "That category is for the other kind"
            )
    if (
        p.end_rule.get("kind") == "date"
        and str(p.end_rule["date"]) < p.start.isoformat()
    ):
        raise invalid("end_before_start", "It ends before it starts")


def _planned_values(data: S.PlannedFields) -> dict[str, Any]:
    values = data.model_dump(exclude_unset=True, exclude={"id", "schedule", "end_rule"})
    if data.schedule is not None:
        values["schedule"] = S.dump_value(data.schedule)
    if data.end_rule is not None:
        values["end_rule"] = S.dump_value(data.end_rule)
    return values


def add_planned(ctx: Ctx, *, data: S.PlannedCreate) -> PlannedItem:
    repo.settings_row(ctx)
    values = _planned_values(data)
    if "start" not in values:
        sched = values["schedule"]
        values["start"] = (
            date.fromisoformat(sched["date"]) if sched["kind"] == "once" else ctx.today
        )
    values.setdefault("end_rule", {"kind": "never"})
    p, _ = owned_repo.upsert(ctx, PlannedItem, data.id or uuid.uuid4(), values)
    _check_planned(ctx, p)
    _dirty(ctx, ctx.today)
    ctx.commit()
    return p


def update_planned(
    ctx: Ctx, *, planned_id: uuid.UUID, data: S.PlannedFields
) -> PlannedItem:
    p = _update_planned(ctx, planned_id, data)
    ctx.commit()
    return p


def _update_planned(
    ctx: Ctx, planned_id: uuid.UUID, data: S.PlannedFields
) -> PlannedItem:
    """Edit one planned item (flush only; the caller commits)."""
    p = _planned(ctx, planned_id)
    patch = _planned_values(data)
    for key in ("name", "type", "amount_minor", "account_id", "start"):
        if key in patch and patch[key] is None:
            raise invalid("field_required", "That field cannot be empty")
    owned_repo.apply(p, patch)
    if p.type != "transfer" and "to_account_id" not in patch:
        p.to_account_id = None
    _check_planned(ctx, p)
    ctx.session.add(p)
    ctx.session.flush()
    _dirty(ctx, ctx.today)
    return p


def delete_planned(ctx: Ctx, *, planned_id: uuid.UUID) -> None:
    """Only a planned item that never settled can be deleted; archive (or
    end) the rest so its history keeps its link."""
    p = _planned(ctx, planned_id)
    if owned_repo.count_rows(ctx, FinRecord, col(FinRecord.planned_id) == p.id):
        raise conflict(
            "planned_has_records", "It has paid occurrences — archive it instead"
        )
    owned_repo.soft_delete(ctx, p)
    _dirty(ctx, ctx.today)
    ctx.commit()


def _require_occurrence(p: PlannedItem, day: date) -> None:
    if not calc.occurrences(repo.plan_of(p), day, day):
        raise invalid("not_an_occurrence", "That day is not on this item's schedule")


def settle_record_id(planned_id: uuid.UUID, day: date) -> uuid.UUID:
    return derived_id("planned-record", planned_id, day.isoformat())


def _settle(
    ctx: Ctx,
    planned_id: uuid.UUID,
    day: date,
    amount_minor: int | None = None,
    account_id: uuid.UUID | None = None,
    on: date | None = None,
    source: str = "planned",
) -> FinRecord:
    p = _planned(ctx, planned_id)
    _require_occurrence(p, day)
    rid = settle_record_id(p.id, day)
    existing = owned_repo.get(ctx, FinRecord, rid)
    if existing is not None:
        return existing  # settling twice is the same record
    when_day = on or ctx.today
    local = ctx.now.astimezone(ctx.clock.zone)
    at = ctx.clock.local_time(when_day, f"{local.hour:02d}:{local.minute:02d}")
    acct = account_id or p.account_id
    _check_record(
        ctx,
        type=p.type,
        account_id=acct,
        to_account_id=p.to_account_id,
        category_id=p.category_id if p.type != "transfer" else None,
        is_refund=False,
    )
    rec = _put_record(
        ctx,
        rid,
        {
            "type": p.type,
            "amount_minor": amount_minor or p.amount_minor,
            "account_id": acct,
            "to_account_id": p.to_account_id,
            "category_id": p.category_id if p.type != "transfer" else None,
            "payee": p.name,
            "planned_id": p.id,
            "planned_on": day,
            "at": at,
            "source": source,
            "status": "cleared",
            "fee_of": None,
            "is_adjustment": False,
            "is_refund": False,
        },
    )
    _dirty(ctx, day)
    return rec


def settle_occurrence(
    ctx: Ctx,
    *,
    planned_id: uuid.UUID,
    day: date,
    amount_minor: int | None = None,
    account_id: uuid.UUID | None = None,
    on: date | None = None,
) -> FinRecord:
    """FIN-22 Paid: one record per occurrence, with the derived id
    ``derived_id("planned-record", planned_id, day)`` so a replay (or the
    device's optimistic copy) is the same row."""
    rec = _settle(ctx, planned_id, day, amount_minor, account_id, on)
    ctx.commit()
    return rec


def _skip(ctx: Ctx, planned_id: uuid.UUID, day: date) -> PlannedSkip:
    p = _planned(ctx, planned_id)
    _require_occurrence(p, day)
    row, _ = owned_repo.upsert(
        ctx,
        PlannedSkip,
        derived_id("planned-skip", p.id, day.isoformat()),
        {"planned_id": p.id, "on_day": day},
        natural_key=("planned_id", "on_day"),
    )
    _dirty(ctx, day)
    return row


def skip_occurrence(ctx: Ctx, *, planned_id: uuid.UUID, day: date) -> PlannedSkip:
    row = _skip(ctx, planned_id, day)
    ctx.commit()
    return row


def _unskip(ctx: Ctx, planned_id: uuid.UUID, day: date) -> None:
    p = _planned(ctx, planned_id)
    row = owned_repo.find_one(
        ctx,
        PlannedSkip,
        col(PlannedSkip.planned_id) == p.id,
        col(PlannedSkip.on_day) == day,
    )
    if row is not None:
        owned_repo.soft_delete(ctx, row)
        _dirty(ctx, day)


def unskip_occurrence(ctx: Ctx, *, planned_id: uuid.UUID, day: date) -> None:
    _unskip(ctx, planned_id, day)
    ctx.commit()


def _snooze(ctx: Ctx, planned_id: uuid.UUID, day: date, days: int) -> PlannedSnooze:
    p = _planned(ctx, planned_id)
    _require_occurrence(p, day)
    cur = owned_repo.find_one(
        ctx,
        PlannedSnooze,
        col(PlannedSnooze.planned_id) == p.id,
        col(PlannedSnooze.on_day) == day,
    )
    base = cur.until_day if cur is not None else day
    if base < ctx.today:
        base = ctx.today
    until = base + timedelta(days=days)
    row, _ = owned_repo.upsert(
        ctx,
        PlannedSnooze,
        derived_id("planned-snooze", p.id, day.isoformat()),
        {"planned_id": p.id, "on_day": day, "until_day": until},
        natural_key=("planned_id", "on_day"),
    )
    _dirty(ctx, day, until)
    return row


def snooze_occurrence(
    ctx: Ctx, *, planned_id: uuid.UUID, day: date, days: int = 1
) -> PlannedSnooze:
    """Push an occurrence ``days`` later, from its current snooze or from
    today when that is already past."""
    row = _snooze(ctx, planned_id, day, days)
    ctx.commit()
    return row


def auto_log_due(ctx: Ctx) -> list[FinRecord]:
    """Log every due or overdue occurrence (today or earlier) of an item set
    to auto-log, at its planned amount. Idempotent through the derived
    settle id. Runs on app open (IA: no background execution) and as a job."""
    s = repo.load_state(ctx)
    out: list[FinRecord] = []
    for o in calc.due_now(s):
        if not o.item.auto_log or o.day > ctx.today:
            continue
        out.append(_settle(ctx, uuid.UUID(o.item.id), o.orig, on=o.day))
    ctx.commit()
    return out


def planned_public(
    p: PlannedItem, skipped: set[date], snoozed: dict[date, date]
) -> S.PlannedPublic:
    return S.PlannedPublic(
        id=p.id,
        name=p.name,
        type=p.type,
        amount_minor=p.amount_minor,
        estimated=p.estimated,
        account_id=p.account_id,
        to_account_id=p.to_account_id,
        category_id=p.category_id,
        schedule=p.schedule,
        start=p.start,
        end_rule=p.end_rule,
        auto_log=p.auto_log,
        is_what_if=p.is_what_if,
        is_installment=p.is_installment,
        in_projection=p.in_projection,
        archived=p.archived,
        skipped=sorted(skipped),
        snoozed={k.isoformat(): v for k, v in sorted(snoozed.items())},
        monthly_eq_minor=r2(calc.monthly_eq(repo.plan_of(p))),
        version=p.version,
    )


def list_planned(
    ctx: Ctx, *, tab: str | None, include_archived: bool, skip: int, limit: int
) -> S.PlannedList:
    where: list[Any] = []
    if not include_archived:
        where.append(col(PlannedItem.archived).is_(False))
    if tab == "what-if":
        where.append(col(PlannedItem.is_what_if).is_(True))
    elif tab in ("recurring", "one-off"):
        where.append(col(PlannedItem.is_what_if).is_(False))
        kind = col(PlannedItem.schedule)["kind"].astext
        where.append(kind == "once" if tab == "one-off" else kind != "once")
    rows = owned_repo.list_rows(
        ctx,
        PlannedItem,
        *where,
        order_by=[col(PlannedItem.created_at), col(PlannedItem.id)],
        skip=skip,
        limit=limit,
    )
    count = owned_repo.count_rows(ctx, PlannedItem, *where)
    skips, snoozes = repo.skips_and_snoozes(ctx, [p.id for p in rows])
    live = owned_repo.list_rows(
        ctx,
        PlannedItem,
        col(PlannedItem.archived).is_(False),
        col(PlannedItem.is_what_if).is_(False),
    )
    m_in = sum(calc.monthly_eq(repo.plan_of(p)) for p in live if p.type == "income")
    m_out = sum(calc.monthly_eq(repo.plan_of(p)) for p in live if p.type == "expense")
    return S.PlannedList(
        data=[planned_public(p, skips[p.id], snoozes[p.id]) for p in rows],
        count=count,
        monthly_in_minor=r2(m_in),
        monthly_out_minor=r2(m_out),
    )


def planned_detail(ctx: Ctx, *, planned_id: uuid.UUID) -> S.PlannedPublic:
    p = _planned(ctx, planned_id)
    skips, snoozes = repo.skips_and_snoozes(ctx, [p.id])
    return planned_public(p, skips[p.id], snoozes[p.id])


def _occ_out(o: calc.Occurrence) -> S.OccurrenceOut:
    return S.OccurrenceOut(
        planned_id=uuid.UUID(o.item.id),
        name=o.item.name,
        type=o.item.type,
        amount_minor=o.item.amount,
        day=o.day,
        orig=o.orig,
        status=o.status,
        record_id=uuid.UUID(o.record_id) if o.record_id else None,
    )


def occurrences_view(
    ctx: Ctx,
    *,
    first: date,
    last: date,
    include_what_if: bool,
    planned_id: uuid.UUID | None,
) -> S.OccurrencesPublic:
    if last < first:
        raise invalid("bad_range", "The range ends before it starts")
    if (last - first).days > 800:
        raise invalid("range_too_long", "Ask for at most two years at a time")
    s = repo.load_state(ctx)
    if planned_id is not None:
        _planned(ctx, planned_id)
        s.planned = [p for p in s.planned if p.id == str(planned_id)]
    rows = [
        _occ_out(o)
        for o in calc.occurrences_in(s, first, last, include_what_if=include_what_if)
    ]
    ctx.commit()
    return S.OccurrencesPublic(data=rows, count=len(rows))


def due_view(ctx: Ctx) -> S.OccurrencesPublic:
    s = repo.load_state(ctx)
    rows = [_occ_out(o) for o in calc.due_now(s)]
    ctx.commit()
    return S.OccurrencesPublic(data=rows, count=len(rows))


# ---------------------------------------------------------------------------
# Projection, reports, look-backs, home
# ---------------------------------------------------------------------------


def _low(lo: calc.Low) -> S.LowOut:
    return S.LowOut(value_minor=r2(lo.value), key=lo.key)


def projection_out(p: calc.Projection, floor: int) -> S.ProjectionOut:
    return S.ProjectionOut(
        start_minor=p.start,
        months=[
            S.ProjMonthOut(
                key=m.key,
                inflow_minor=m.inflow,
                planned_minor=m.planned,
                unplanned_minor=r2(m.unplanned),
                what_if_minor=r2(m.what_if),
                net_minor=r2(m.net),
                end_minor=r2(m.end),
                end_base_minor=r2(m.end_base),
            )
            for m in p.months
        ],
        avg_unplanned_minor=r2(p.avg_unplanned),
        low=_low(p.low),
        low_base=_low(p.low_base),
        avg_surplus_minor=r2(p.avg_surplus),
        has_income=p.has_income,
        recovery_months=p.recovery_months,
        safety_floor_minor=floor,
        verdict="no" if p.low.value < 0 else "tight" if p.low.value < floor else "ok",
    )


def projection(ctx: Ctx, *, data: S.ProjectionIn) -> S.ProjectionOut:
    """FIN-23/24: the savings projection, with what-if and exclusions. The
    settings supply the horizon, the unplanned basis and the excluded items
    unless the request overrides them."""
    st = _settings(ctx)
    s = repo.load_state(ctx, st)
    extra: list[calc.Plan] = []
    for pid in data.extra_planned_ids:
        item = next((p for p in s.planned if p.id == str(pid)), None)
        if item is None:
            raise not_found("planned_item")
        extra.append(item)
    p = calc.project(
        s,
        horizon=data.horizon or st.horizon,
        include_unplanned=st.include_unplanned
        if data.include_unplanned is None
        else data.include_unplanned,
        excluded_planned=[str(x) for x in data.excluded_planned]
        if data.excluded_planned is not None
        else st.proj_excluded_planned,
        excluded_accounts=[str(x) for x in data.excluded_accounts],
        what_if=calc.WhatIf(
            data.what_if.amount_minor, data.what_if.month, data.what_if.installments
        )
        if data.what_if
        else None,
        extra_planned=extra,
    )
    out = projection_out(p, st.safety_floor_minor)
    ctx.commit()
    return out


def _flow_out(f: calc.Flow) -> S.FlowOut:
    return S.FlowOut(
        income_minor=f.income,
        spend_minor=f.spend,
        savings_rate=calc.savings_rate(f),
        count=f.count,
        by_category=sorted(f.by_cat.items(), key=lambda kv: -kv[1]),
        by_payee=sorted(f.by_payee.items(), key=lambda kv: -kv[1]),
    )


def report(ctx: Ctx, *, period: calc.Period) -> S.ReportOut:
    s = repo.load_state(ctx)
    r = calc.report_data(s, period)
    pubs = _budget_pubs(ctx, owned_repo.list_rows(ctx, Budget))
    out = S.ReportOut(
        period=period,
        first=r.range.first,
        last=r.range.last,
        prev_first=r.range.prev_first,
        prev_last=r.range.prev_last,
        month=r.range.month,
        flow=_flow_out(r.flow),
        prev=_flow_out(r.prev),
        daily_minor=r.daily,
        days=r.days,
        weekday_avg_minor=[r2(x) for x in r.weekday_avg],
        months=r.months,
        budgets=[
            (uuid.UUID(b.id), [_view_out(s, v, pubs[b.id]) for v in hist])
            for b, hist in r.budgets
        ],
        net_worth_minor=r.net_worth,
    )
    ctx.commit()
    return out


def lookback_view(
    ctx: Ctx, *, period: str | None, first: date | None, last: date | None
) -> S.LookbackOut:
    """FIN-32 for a budget month (``YYYY-MM``) or a custom range."""
    st = _settings(ctx)
    s = repo.load_state(ctx, st)
    sd = st.month_start_day
    if period is not None:
        try:
            f, t = calc.month_range(period, sd)
        except ValueError as exc:
            raise invalid("bad_period", "Use a YYYY-MM month") from exc
        pf, pt = calc.month_range(calc.add_months(period, -1), sd)
    elif first is not None and last is not None:
        if last < first or (last - first).days > 400:
            raise invalid("bad_range", "Pick a range of up to a year")
        f, t = first, last
        length = (t - f).days + 1
        pf, pt = f - timedelta(days=length), f - timedelta(days=1)
    else:
        mk = calc.add_months(calc.month_of(ctx.today, sd), -1)
        period = mk
        f, t = calc.month_range(mk, sd)
        pf, pt = calc.month_range(calc.add_months(mk, -1), sd)
    x = calc.lookback(s, f, t, pf, pt)
    pubs = _budget_pubs(ctx, owned_repo.list_rows(ctx, Budget))
    saved = (
        owned_repo.find_one(ctx, LookBack, col(LookBack.period) == period)
        if period
        else None
    )
    out = S.LookbackOut(
        first=f,
        last=t,
        prev_first=pf,
        prev_last=pt,
        flow=_flow_out(x.flow),
        prev=_flow_out(x.prev),
        base_minor=r2(x.base),
        savings_rate=x.rate,
        prev_savings_rate=x.prev_rate,
        no_spend_count=x.no_spend.count,
        no_spend_streak=x.no_spend.streak,
        budgets=[_view_out(s, v, pubs[v.budget.id]) for v in x.budgets],
        kept=[uuid.UUID(v.budget.id) for v in x.kept],
        blown=[uuid.UUID(v.budget.id) for v in x.blown],
        where=x.where,
        spikes=[w[0] for w in x.spikes],
        big_record_ids=[uuid.UUID(r.id) for r in x.big],
        leaks=[
            S.LeakOut(payee=lk.payee, n=lk.n, total_minor=lk.v, category_id=lk.cat)
            for lk in x.leaks
        ],
        subs_minor=x.subs,
        completeness=x.completeness,
        top_share=x.top_share,
        saved=S.LookBackPublic.model_validate(saved) if saved else None,
    )
    ctx.commit()
    return out


def save_look_back(ctx: Ctx, *, data: S.LookBackSave) -> LookBack:
    """Save (or re-save) the note and snapshot of one period's review."""
    repo.settings_row(ctx)
    row, _ = owned_repo.upsert(
        ctx,
        LookBack,
        data.id or derived_id("look-back", ctx.user_id, data.period),
        {
            "period": data.period,
            "note": data.note,
            "saved_at": ctx.now,
            "snapshot": data.snapshot.model_dump(mode="json"),
        },
        natural_key=("period",),
    )
    ctx.commit()
    return row


def home(ctx: Ctx) -> S.HomeOut:
    st = _settings(ctx)
    s = repo.load_state(ctx, st)
    t = s.today
    mk = calc.month_of(t, st.month_start_day)
    f, last = calc.month_range(mk, st.month_start_day)
    flow = calc.flow_in(s, f, last)
    rows = owned_repo.list_rows(
        ctx, Budget, col(Budget.archived).is_(False), order_by=[col(Budget.created_at)]
    )
    pubs = _budget_pubs(ctx, rows)
    main = next(
        (b for b in s.budgets if not b.archived and b.category_ids is None), None
    ) or next((b for b in s.budgets if not b.archived), None)
    occ = calc.occurrences_in(s, t, t + timedelta(days=7))
    views = account_views(ctx, s)
    proj = (
        calc.project(
            s,
            horizon=st.horizon,
            include_unplanned=st.include_unplanned,
            excluded_planned=st.proj_excluded_planned,
        )
        if s.accounts
        else None
    )
    out = S.HomeOut(
        setup_done=st.setup_done,
        net_worth_minor=calc.net_worth(s),
        liquid_minor=calc.liquid(s),
        accounts=[v for v in views if not v.archived],
        spent_this_month_minor=flow.spend,
        income_this_month_minor=flow.income,
        main_budget=_view_out(s, calc.budget_view(s, main), pubs[main.id])
        if main
        else None,
        upcoming=[_occ_out(o) for o in occ if o.status in ("due", "upcoming")],
        due=[_occ_out(o) for o in calc.due_now(s)],
        pending_records=sum(1 for r in s.records if r.status == "pending"),
        stale_accounts=[
            v.id
            for v in views
            if not v.archived
            and v.type in ("bank", "ewallet")
            and (v.reconciled_days_ago if v.reconciled_days_ago is not None else 999)
            > st.nudge_days
        ],
        projection_end_minor=r2(proj.months[-1].end) if proj and proj.months else None,
        projection_low=_low(proj.low) if proj else None,
        net_worth_series_minor=calc.net_worth_series(s, 30),
        runway_months=calc.runway_months(s),
    )
    ctx.commit()
    return out


# ---------------------------------------------------------------------------
# Settings, start fresh, reset, export
# ---------------------------------------------------------------------------


def get_settings(ctx: Ctx) -> FinanceSettings:
    st = _settings(ctx)
    ctx.commit()
    return st


def update_settings(ctx: Ctx, *, data: S.SettingsFields) -> FinanceSettings:
    st = _settings(ctx)
    patch = data.model_dump(exclude_unset=True)
    for key in (
        "month_start_day",
        "horizon",
        "include_unplanned",
        "safety_floor_minor",
        "ai_scope",
        "disclaimer_ack",
        "nudge_days",
        "setup_done",
    ):
        if key in patch and patch[key] is None:
            raise invalid("field_required", "That field cannot be empty")
    if patch.get("default_account_id") is not None:
        _account(ctx, patch["default_account_id"])
    if "proj_excluded_planned" in patch:
        patch["proj_excluded_planned"] = [
            str(x) for x in patch["proj_excluded_planned"] or []
        ]
    owned_repo.apply(st, patch)
    ctx.session.add(st)
    ctx.session.flush()
    if "month_start_day" in patch:
        _dirty(ctx, ctx.today)
    ctx.commit()
    return st


_WIPE: tuple[type[OwnedRow], ...] = (
    AdvisorMessage,
    AdvisorThread,
    LookBack,
    ImportRow,
    StatementImport,
    PlannedSnooze,
    PlannedSkip,
    FinRecord,
    PlannedItem,
    BudgetCategory,
    Budget,
    Account,
    Category,
)


def _wipe(ctx: Ctx) -> None:
    for model in _WIPE:
        _bulk(ctx, model, deleted_at=ctx.now)
    # The defaults come back (revived by their derived ids); custom ones stay gone.
    for slug, name, icon, disc, parent, kind in repo.DEFAULT_CATEGORIES:
        owned_repo.upsert(
            ctx,
            Category,
            repo.category_id_for(ctx, slug),
            {
                "name": name,
                "kind": kind,
                "icon": icon,
                "discretionary": disc,
                "archived": False,
                "parent_id": repo.category_id_for(ctx, parent) if parent else None,
                "system": slug in repo.SYSTEM_SLUGS,
                "slug": slug,
            },
        )
    _dirty(ctx, ctx.today)


def start_fresh(ctx: Ctx) -> FinanceSettings:
    """Empty the ledger (accounts, records, budgets, planned, imports,
    reviews, advisor threads) and restore the default categories. Settings
    stay, except the advisor disclaimer, which must be acknowledged again,
    and setup, which runs again. Rows are tombstoned so devices drop them."""
    st = _settings(ctx)
    _wipe(ctx)
    st.disclaimer_ack = False
    st.setup_done = False
    st.default_account_id = st.last_account_id = st.last_category_id = None
    ctx.session.add(st)
    ctx.commit()
    return st


def reset(ctx: Ctx) -> FinanceSettings:
    """Start fresh AND put every setting back to its default. (The prototype's
    reset restores its demo seed; the server has no demo data to restore.)"""
    st = _settings(ctx)
    _wipe(ctx)
    defaults = FinanceSettings(owner_id=ctx.user_id, tenant_id=ctx.tenant_id)
    for key in (
        "month_start_day",
        "horizon",
        "include_unplanned",
        "safety_floor_minor",
        "ai_scope",
        "disclaimer_ack",
        "nudge_days",
        "bill_reminder",
        "setup_done",
    ):
        setattr(st, key, getattr(defaults, key))
    st.proj_excluded_planned = []
    st.default_account_id = st.last_account_id = st.last_category_id = None
    ctx.session.add(st)
    ctx.commit()
    return st


EXPORT_COLUMNS = (
    "date",
    "time",
    "type",
    "amount",
    "account",
    "to_account",
    "category",
    "payee",
    "note",
    "source",
    "status",
    "refund",
    "adjustment",
    "id",
)
EXPORT_MAX_ROWS = 100_000


def _csv_cell(v: str) -> str:
    # A spreadsheet runs a cell that starts with = + - @ as a formula.
    return "'" + v if v[:1] in ("=", "+", "-", "@", "\t", "\r") else v


def export_csv(ctx: Ctx) -> str:
    """F-FIN-45: every record as CSV (major units with two decimals, local time)."""
    accounts = {
        a.id: a.name for a in owned_repo.list_rows(ctx, Account, include_deleted=True)
    }
    cats = {
        c.id: c.name for c in owned_repo.list_rows(ctx, Category, include_deleted=True)
    }
    rows = owned_repo.list_rows(
        ctx,
        FinRecord,
        order_by=[col(FinRecord.at), col(FinRecord.id)],
        limit=EXPORT_MAX_ROWS,
    )
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(EXPORT_COLUMNS)
    for r in rows:
        local = r.at.astimezone(ctx.clock.zone)
        w.writerow(
            [
                _day(ctx, r.at).isoformat(),
                local.strftime("%H:%M"),
                r.type,
                f"{r.amount_minor // 100}.{r.amount_minor % 100:02d}",
                _csv_cell(accounts.get(r.account_id, "")),
                _csv_cell(accounts.get(r.to_account_id, "") if r.to_account_id else ""),
                _csv_cell(cats.get(r.category_id, "") if r.category_id else ""),
                _csv_cell(r.payee or ""),
                _csv_cell(r.note or ""),
                r.source,
                r.status,
                "yes" if r.is_refund else "",
                "yes" if r.is_adjustment else "",
                str(r.id),
            ]
        )
    return buf.getvalue()


# ---------------------------------------------------------------------------
# Advisor threads (CRUD only; the AI answer lives in the companion)
# ---------------------------------------------------------------------------


def create_thread(ctx: Ctx, *, data: S.ThreadCreate) -> AdvisorThread:
    row, _ = owned_repo.upsert(
        ctx, AdvisorThread, data.id or uuid.uuid4(), {"title": data.title}
    )
    ctx.commit()
    return row


def rename_thread(ctx: Ctx, *, thread_id: uuid.UUID, title: str) -> AdvisorThread:
    row = owned_repo.require(ctx, AdvisorThread, thread_id, what="thread")
    row.title = title
    ctx.session.add(row)
    ctx.commit()
    return row


def delete_thread(ctx: Ctx, *, thread_id: uuid.UUID) -> None:
    row = owned_repo.require(ctx, AdvisorThread, thread_id, what="thread")
    _bulk(
        ctx, AdvisorMessage, col(AdvisorMessage.thread_id) == row.id, deleted_at=ctx.now
    )
    owned_repo.soft_delete(ctx, row)
    ctx.commit()


def list_threads(ctx: Ctx, *, skip: int, limit: int) -> tuple[list[AdvisorThread], int]:
    rows = owned_repo.list_rows(
        ctx,
        AdvisorThread,
        order_by=[col(AdvisorThread.created_at).desc()],
        skip=skip,
        limit=limit,
    )
    return rows, owned_repo.count_rows(ctx, AdvisorThread)


def thread_messages(
    ctx: Ctx, *, thread_id: uuid.UUID, limit: int = 500
) -> tuple[AdvisorThread, list[AdvisorMessage]]:
    row = owned_repo.require(ctx, AdvisorThread, thread_id, what="thread")
    msgs = owned_repo.list_rows(
        ctx,
        AdvisorMessage,
        col(AdvisorMessage.thread_id) == row.id,
        order_by=[col(AdvisorMessage.at), col(AdvisorMessage.id)],
        limit=limit,
    )
    return row, msgs


def _add_message(
    ctx: Ctx, thread_id: uuid.UUID, data: S.MessageCreate
) -> AdvisorMessage:
    thread = owned_repo.require(ctx, AdvisorThread, thread_id, what="thread")
    row, _ = owned_repo.upsert(
        ctx,
        AdvisorMessage,
        data.id or uuid.uuid4(),
        {
            "thread_id": thread.id,
            "role": data.role,
            "text": data.text,
            "answer": data.answer,
            "scope": data.scope,
            "at": ctx.now,
        },
    )
    return row


def add_message(
    ctx: Ctx, *, thread_id: uuid.UUID, data: S.MessageCreate
) -> AdvisorMessage:
    row = _add_message(ctx, thread_id, data)
    ctx.commit()
    return row


def delete_message(ctx: Ctx, *, thread_id: uuid.UUID, message_id: uuid.UUID) -> None:
    thread = owned_repo.require(ctx, AdvisorThread, thread_id, what="thread")
    row = owned_repo.require(ctx, AdvisorMessage, message_id, what="message")
    if row.thread_id != thread.id:
        raise not_found("message")
    owned_repo.soft_delete(ctx, row)
    ctx.commit()
