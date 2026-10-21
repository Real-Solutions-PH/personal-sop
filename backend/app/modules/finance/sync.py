"""Sync registrations for the finance module (entities + domain actions).

Every pushed write goes through the same use cases as REST, so the business
rules (transfer accounts, category kinds, protected system categories, the
records-block on deleting an account or a planned item) guard synced writes
too. Statement imports are REST-only: they are server-driven.
"""

import uuid
from collections.abc import Callable
from datetime import date, datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

from app.modules.finance import schema as S
from app.modules.finance import services
from app.modules.finance.models import (
    Account,
    AdvisorMessage,
    AdvisorThread,
    Budget,
    BudgetCategory,
    Category,
    FinanceSettings,
    FinRecord,
    LookBack,
    PlannedItem,
    PlannedSkip,
    PlannedSnooze,
)
from app.modules.sync.registry import Action, Entity, Registry
from app.shared import owned_repo
from app.shared.context import Ctx
from app.shared.domain import invalid
from app.shared.owned import OwnedRow

# ---------------------------------------------------------------------------
# Row-shaped public schemas (the pull ships table rows)
# ---------------------------------------------------------------------------


class _Row(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    version: int


class BudgetRow(_Row):
    name: str
    period: str
    limit_minor: int
    rollover: bool
    start_date: date
    archived: bool


class BudgetCategoryRow(_Row):
    budget_id: uuid.UUID
    category_id: uuid.UUID


class PlannedRow(_Row):
    name: str
    type: str
    amount_minor: int
    estimated: bool
    account_id: uuid.UUID
    to_account_id: uuid.UUID | None
    category_id: uuid.UUID | None
    schedule: dict[str, Any]
    start: date
    end_rule: dict[str, Any]
    auto_log: bool
    is_what_if: bool
    is_installment: bool
    in_projection: bool
    archived: bool


class SkipRow(_Row):
    planned_id: uuid.UUID
    on_day: date


class SnoozeRow(_Row):
    planned_id: uuid.UUID
    on_day: date
    until_day: date


class MessageRow(_Row):
    thread_id: uuid.UUID
    role: str
    text: str
    at: datetime
    answer: dict[str, Any] | None
    scope: str


class ThreadRow(_Row):
    title: str
    created_at: datetime


# ---------------------------------------------------------------------------
# Payloads (every field optional: field-level last-writer-wins)
# ---------------------------------------------------------------------------


class RecordSync(S.RecordFields):
    fee_minor: S.NonNegMinor | None = None


class BudgetCategorySync(BaseModel):
    budget_id: uuid.UUID | None = None
    category_id: uuid.UUID | None = None


class SkipSync(BaseModel):
    planned_id: uuid.UUID | None = None
    on_day: date | None = None


class SnoozeSync(SkipSync):
    until_day: date | None = None


class LookBackSync(BaseModel):
    period: str | None = Field(
        default=None, min_length=7, max_length=16, pattern=r"^\d{4}-(\d{2}|W\d{2})$"
    )
    note: str | None = Field(default=None, max_length=2000)
    snapshot: S.Snapshot | None = None


class ThreadSync(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=120)


class MessageSync(BaseModel):
    thread_id: uuid.UUID | None = None
    role: Literal["user", "ai"] | None = None
    text: str | None = Field(default=None, min_length=1, max_length=8000)
    answer: dict[str, Any] | None = None
    scope: S.Scope | None = None


# ---------------------------------------------------------------------------
# Upsert / delete hooks
# ---------------------------------------------------------------------------


def _fields(payload: BaseModel) -> dict[str, Any]:
    return payload.model_dump(exclude_unset=True)


def _exists(ctx: Ctx, model: type[OwnedRow], row_id: uuid.UUID) -> bool:
    return owned_repo.get(ctx, model, row_id) is not None


def _account(ctx: Ctx, row_id: uuid.UUID, p: BaseModel) -> OwnedRow:
    assert isinstance(p, S.AccountFields)
    if _exists(ctx, Account, row_id):
        return services.update_account(ctx, account_id=row_id, data=p)
    return services.add_account(ctx, data=S.AccountCreate(id=row_id, **_fields(p)))


def _category(ctx: Ctx, row_id: uuid.UUID, p: BaseModel) -> OwnedRow:
    assert isinstance(p, S.CategoryFields)
    if _exists(ctx, Category, row_id):
        return services.update_category(ctx, category_id=row_id, data=p)
    return services.add_category(ctx, data=S.CategoryCreate(id=row_id, **_fields(p)))


def _record(ctx: Ctx, row_id: uuid.UUID, p: BaseModel) -> OwnedRow:
    assert isinstance(p, RecordSync)
    if _exists(ctx, FinRecord, row_id):
        patch = {k: v for k, v in _fields(p).items() if k != "fee_minor"}
        return services.update_record(
            ctx, record_id=row_id, data=S.RecordUpdate(**patch)
        )
    data = _fields(p)
    data["fee_minor"] = data.get("fee_minor") or 0
    return services.add_record(ctx, data=S.RecordCreate(id=row_id, **data))[0]


def _budget(ctx: Ctx, row_id: uuid.UUID, p: BaseModel) -> OwnedRow:
    assert isinstance(p, S.BudgetFields)
    if _exists(ctx, Budget, row_id):
        return services.update_budget(ctx, budget_id=row_id, data=p)
    return services.add_budget(ctx, data=S.BudgetCreate(id=row_id, **_fields(p)))


def _budget_category(ctx: Ctx, row_id: uuid.UUID, p: BaseModel) -> OwnedRow:
    assert isinstance(p, BudgetCategorySync)
    row = owned_repo.get(ctx, BudgetCategory, row_id)
    budget_id = p.budget_id or (row.budget_id if row else None)
    category_id = p.category_id or (row.category_id if row else None)
    if budget_id is None or category_id is None:
        raise invalid("missing_fields", "A budget and a category are required")
    owned_repo.require(ctx, Budget, budget_id, what="budget")
    if (
        owned_repo.require(ctx, Category, category_id, what="category").kind
        != "expense"
    ):
        raise invalid("category_kind_mismatch", "Budgets cover expense categories")
    link, _ = owned_repo.upsert(
        ctx,
        BudgetCategory,
        row_id,
        {"budget_id": budget_id, "category_id": category_id},
        natural_key=("budget_id", "category_id"),
    )
    services._dirty(ctx, ctx.today)
    ctx.commit()
    return link


def _planned(ctx: Ctx, row_id: uuid.UUID, p: BaseModel) -> OwnedRow:
    assert isinstance(p, S.PlannedFields)
    if _exists(ctx, PlannedItem, row_id):
        return services.update_planned(ctx, planned_id=row_id, data=p)
    return services.add_planned(
        ctx,
        data=S.PlannedCreate.model_validate(
            {"id": row_id, **p.model_dump(exclude_unset=True)}
        ),
    )


def _skip(ctx: Ctx, row_id: uuid.UUID, p: BaseModel) -> OwnedRow:
    del row_id  # one skip per (item, day): the derived id is canonical
    assert isinstance(p, SkipSync)
    if p.planned_id is None or p.on_day is None:
        raise invalid("missing_fields", "A planned item and a day are required")
    return services.skip_occurrence(ctx, planned_id=p.planned_id, day=p.on_day)


def _snooze(ctx: Ctx, row_id: uuid.UUID, p: BaseModel) -> OwnedRow:
    assert isinstance(p, SnoozeSync)
    row = owned_repo.get(ctx, PlannedSnooze, row_id)
    planned_id = p.planned_id or (row.planned_id if row else None)
    on_day = p.on_day or (row.on_day if row else None)
    until = p.until_day or (row.until_day if row else None)
    if planned_id is None or on_day is None or until is None:
        raise invalid("missing_fields", "A planned item and both days are required")
    item = owned_repo.require(ctx, PlannedItem, planned_id, what="planned_item")
    services._require_occurrence(item, on_day)
    if until < on_day:
        raise invalid("snooze_backwards", "A snooze moves an occurrence later")
    out, _ = owned_repo.upsert(
        ctx,
        PlannedSnooze,
        row_id,
        {"planned_id": planned_id, "on_day": on_day, "until_day": until},
        natural_key=("planned_id", "on_day"),
    )
    services._dirty(ctx, on_day, until)
    ctx.commit()
    return out


def _look_back(ctx: Ctx, row_id: uuid.UUID, p: BaseModel) -> OwnedRow:
    assert isinstance(p, LookBackSync)
    row = owned_repo.get(ctx, LookBack, row_id)
    if row is not None:
        patch = _fields(p)
        if "snapshot" in patch:
            patch["snapshot"] = (
                p.snapshot.model_dump(mode="json") if p.snapshot else row.snapshot
            )
        owned_repo.apply(row, patch | {"saved_at": ctx.now})
        ctx.session.add(row)
        ctx.commit()
        return row
    if p.period is None or p.snapshot is None:
        raise invalid("missing_fields", "A period and a snapshot are required")
    return services.save_look_back(
        ctx,
        data=S.LookBackSave(
            id=row_id, period=p.period, note=p.note or "", snapshot=p.snapshot
        ),
    )


def _thread(ctx: Ctx, row_id: uuid.UUID, p: BaseModel) -> OwnedRow:
    assert isinstance(p, ThreadSync)
    if _exists(ctx, AdvisorThread, row_id):
        if p.title is None:
            return owned_repo.require(ctx, AdvisorThread, row_id, what="thread")
        return services.rename_thread(ctx, thread_id=row_id, title=p.title)
    if p.title is None:
        raise invalid("missing_fields", "A title is required")
    return services.create_thread(ctx, data=S.ThreadCreate(id=row_id, title=p.title))


def _message(ctx: Ctx, row_id: uuid.UUID, p: BaseModel) -> OwnedRow:
    assert isinstance(p, MessageSync)
    row = owned_repo.get(ctx, AdvisorMessage, row_id)
    if row is not None:
        if p.thread_id is not None and p.thread_id != row.thread_id:
            raise invalid("message_thread_fixed", "A message stays in its thread")
        owned_repo.apply(row, {k: v for k, v in _fields(p).items() if k != "thread_id"})
        ctx.session.add(row)
        ctx.commit()
        return row
    if p.thread_id is None or p.role is None or p.text is None:
        raise invalid("missing_fields", "A thread, a role and a text are required")
    return services.add_message(
        ctx,
        thread_id=p.thread_id,
        data=S.MessageCreate(
            id=row_id,
            role=p.role,
            text=p.text,
            answer=p.answer,
            scope=p.scope or "aggregates",
        ),
    )


def _settings(ctx: Ctx, row_id: uuid.UUID, p: BaseModel) -> OwnedRow:
    del row_id  # one settings row per user, whatever id the device holds
    assert isinstance(p, S.SettingsFields)
    return services.update_settings(ctx, data=p)


def _refuse_delete(what: str) -> Callable[[Ctx, uuid.UUID], None]:
    def delete(ctx: Ctx, row_id: uuid.UUID) -> None:
        del ctx, row_id
        raise invalid(f"{what}_not_deletable", "This cannot be deleted")

    return delete


# ---------------------------------------------------------------------------
# Actions
# ---------------------------------------------------------------------------


def _settle(ctx: Ctx, args: dict[str, Any]) -> dict[str, Any]:
    a = S.Settle.model_validate(args)
    rec = services.settle_occurrence(
        ctx,
        planned_id=a.planned_id,
        day=a.day,
        amount_minor=a.amount_minor,
        account_id=a.account_id,
        on=a.paid_on,
    )
    return {"record_id": str(rec.id)}


def _skip_action(ctx: Ctx, args: dict[str, Any]) -> dict[str, Any]:
    a = S.OccurrenceRef.model_validate(args)
    row = services.skip_occurrence(ctx, planned_id=a.planned_id, day=a.day)
    return {"skip_id": str(row.id)}


def _unskip(ctx: Ctx, args: dict[str, Any]) -> dict[str, Any]:
    a = S.OccurrenceRef.model_validate(args)
    services.unskip_occurrence(ctx, planned_id=a.planned_id, day=a.day)
    return {}


def _snooze_action(ctx: Ctx, args: dict[str, Any]) -> dict[str, Any]:
    a = S.Snooze.model_validate(args)
    row = services.snooze_occurrence(
        ctx, planned_id=a.planned_id, day=a.day, days=a.days
    )
    return {"snooze_id": str(row.id), "until_day": row.until_day.isoformat()}


class AdjustArgs(S.AdjustBalance):
    account_id: uuid.UUID


def _adjust(ctx: Ctx, args: dict[str, Any]) -> dict[str, Any]:
    a = AdjustArgs.model_validate(args)
    rec = services.adjust_balance(
        ctx,
        account_id=a.account_id,
        actual_minor=a.actual_minor,
        note=a.note,
        record_id=a.record_id,
    )
    return {"record_id": str(rec.id) if rec else None}


def _recategorise(ctx: Ctx, args: dict[str, Any]) -> dict[str, Any]:
    a = S.Recategorise.model_validate(args)
    rows = services.recategorise(ctx, record_ids=a.ids, category_id=a.category_id)
    return {"ids": [str(r.id) for r in rows]}


class DeleteCategoryArgs(S.DeleteCategory):
    category_id: uuid.UUID


def _delete_category(ctx: Ctx, args: dict[str, Any]) -> dict[str, Any]:
    a = DeleteCategoryArgs.model_validate(args)
    services.delete_category(ctx, category_id=a.category_id, move_to=a.move_to)
    return {}


class ConfirmArgs(BaseModel):
    record_id: uuid.UUID


def _confirm(ctx: Ctx, args: dict[str, Any]) -> dict[str, Any]:
    a = ConfirmArgs.model_validate(args)
    rec = services.confirm_record(ctx, record_id=a.record_id)
    return {"record_id": str(rec.id)}


def _delete_with(fn: Callable[..., None], key: str) -> Callable[[Ctx, uuid.UUID], None]:
    def delete(ctx: Ctx, row_id: uuid.UUID) -> None:
        fn(ctx, **{key: row_id})

    return delete


def register(r: Registry) -> None:
    r.entity(
        Entity(
            name="account",
            model=Account,
            payload=S.AccountFields,
            public=S.AccountPublic,
            upsert=_account,
            delete=_delete_with(services.delete_account, "account_id"),
            create_required=("name", "type"),
        )
    )
    r.entity(
        Entity(
            name="category",
            model=Category,
            payload=S.CategoryFields,
            public=S.CategoryPublic,
            upsert=_category,
            delete=_delete_with(services.delete_category, "category_id"),
            create_required=("name", "kind"),
        )
    )
    r.entity(
        Entity(
            name="fin_record",
            model=FinRecord,
            payload=RecordSync,
            public=S.RecordPublic,
            upsert=_record,
            delete=services.delete_record,
            create_required=("type", "amount_minor", "account_id"),
        )
    )
    r.entity(
        Entity(
            name="budget",
            model=Budget,
            payload=S.BudgetFields,
            public=BudgetRow,
            upsert=_budget,
            delete=_delete_with(services.delete_budget, "budget_id"),
            create_required=("name", "limit_minor"),
        )
    )
    r.entity(
        Entity(
            name="budget_category",
            model=BudgetCategory,
            payload=BudgetCategorySync,
            public=BudgetCategoryRow,
            upsert=_budget_category,
            create_required=("budget_id", "category_id"),
        )
    )
    r.entity(
        Entity(
            name="planned_item",
            model=PlannedItem,
            payload=S.PlannedFields,
            public=PlannedRow,
            upsert=_planned,
            delete=_delete_with(services.delete_planned, "planned_id"),
            create_required=("name", "type", "amount_minor", "account_id", "schedule"),
        )
    )
    r.entity(
        Entity(
            name="planned_skip",
            model=PlannedSkip,
            payload=SkipSync,
            public=SkipRow,
            upsert=_skip,
            create_required=("planned_id", "on_day"),
        )
    )
    r.entity(
        Entity(
            name="planned_snooze",
            model=PlannedSnooze,
            payload=SnoozeSync,
            public=SnoozeRow,
            upsert=_snooze,
            create_required=("planned_id", "on_day", "until_day"),
        )
    )
    r.entity(
        Entity(
            name="look_back",
            model=LookBack,
            payload=LookBackSync,
            public=S.LookBackPublic,
            upsert=_look_back,
            create_required=("period", "snapshot"),
        )
    )
    r.entity(
        Entity(
            name="advisor_thread",
            model=AdvisorThread,
            payload=ThreadSync,
            public=ThreadRow,
            upsert=_thread,
            delete=_delete_with(services.delete_thread, "thread_id"),
            create_required=("title",),
        )
    )
    r.entity(
        Entity(
            name="advisor_message",
            model=AdvisorMessage,
            payload=MessageSync,
            public=MessageRow,
            upsert=_message,
            create_required=("thread_id", "role", "text"),
        )
    )
    r.entity(
        Entity(
            name="finance_settings",
            model=FinanceSettings,
            payload=S.SettingsFields,
            public=S.SettingsPublic,
            upsert=_settings,
            delete=_refuse_delete("finance_settings"),
        )
    )
    for name, handler, args in (
        ("finance.settle", _settle, S.Settle),
        ("finance.skip", _skip_action, S.OccurrenceRef),
        ("finance.unskip", _unskip, S.OccurrenceRef),
        ("finance.snooze", _snooze_action, S.Snooze),
        ("finance.adjust_balance", _adjust, AdjustArgs),
        ("finance.recategorise", _recategorise, S.Recategorise),
        ("finance.delete_category_moving", _delete_category, DeleteCategoryArgs),
        ("finance.confirm_record", _confirm, ConfirmArgs),
    ):
        r.action(Action(name=name, handler=handler, args=args))
