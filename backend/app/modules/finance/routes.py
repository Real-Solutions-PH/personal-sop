"""Finance REST routes: one endpoint per screen action (IA M4, FIN-01..37).

Reads need ``finance:read``; writes need ``finance:write`` and are rate
limited. Responses are schemas, never table rows.
"""

import uuid
from datetime import date
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, Query
from fastapi.responses import Response
from sqlmodel import col

from app.modules.finance import advisor, calc, imports, repo, services
from app.modules.finance.advisor_ai import AskIn as AdvisorAskIn
from app.modules.finance import schema as S
from app.modules.finance.models import LookBack
from app.modules.iam.deps import require_permission
from app.shared import owned_repo
from app.shared.context import CtxDep
from app.shared.pagination import PaginationDep
from app.shared.rate_limit import rate_limited

router = APIRouter(prefix="/finance", tags=["finance"])

READ = [Depends(require_permission("finance:read"))]
WRITE = [rate_limited("finance"), Depends(require_permission("finance:write"))]


def _page(items: list[Any], skip: int, limit: int) -> list[Any]:
    return items[skip : skip + limit]


# ---------------------------------------------------------------------------
# Home, settings, data ownership
# ---------------------------------------------------------------------------


@router.get("/home", response_model=S.HomeOut, dependencies=READ)
def home(ctx: CtxDep) -> Any:
    """FIN-01."""
    return services.home(ctx)


@router.get("/settings", response_model=S.SettingsPublic, dependencies=READ)
def get_settings(ctx: CtxDep) -> Any:
    return services.get_settings(ctx)


@router.patch("/settings", response_model=S.SettingsPublic, dependencies=WRITE)
def update_settings(ctx: CtxDep, data: S.SettingsFields) -> Any:
    """FIN-35 / FIN-34 (disclaimer, data scope)."""
    return services.update_settings(ctx, data=data)


@router.post("/start-fresh", response_model=S.SettingsPublic, dependencies=WRITE)
def start_fresh(ctx: CtxDep) -> Any:
    return services.start_fresh(ctx)


@router.post("/reset", response_model=S.SettingsPublic, dependencies=WRITE)
def reset(ctx: CtxDep) -> Any:
    return services.reset(ctx)


@router.get("/export.csv", dependencies=READ)
def export_csv(ctx: CtxDep) -> Response:
    """F-FIN-45: every record as CSV."""
    return Response(
        content=services.export_csv(ctx),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": 'attachment; filename="finance-records.csv"'},
    )


# ---------------------------------------------------------------------------
# Accounts
# ---------------------------------------------------------------------------


@router.get("/accounts", response_model=S.AccountsPublic, dependencies=READ)
def list_accounts(ctx: CtxDep, page: PaginationDep) -> Any:
    """FIN-09: accounts with balances, net worth and the liquid total."""
    out = services.accounts_view(ctx)
    out.data = _page(out.data, page.skip, page.limit)
    return out


@router.post("/accounts", response_model=S.AccountPublic, dependencies=WRITE)
def add_account(ctx: CtxDep, data: S.AccountCreate) -> Any:
    return services.add_account(ctx, data=data)


@router.get("/accounts/{account_id}", response_model=S.AccountDetail, dependencies=READ)
def account_detail(
    ctx: CtxDep, account_id: uuid.UUID, days: Annotated[int, Query(ge=7, le=366)] = 60
) -> Any:
    """FIN-10: balance and its trend."""
    return services.account_detail(ctx, account_id=account_id, days=days)


@router.patch(
    "/accounts/{account_id}", response_model=S.AccountPublic, dependencies=WRITE
)
def update_account(ctx: CtxDep, account_id: uuid.UUID, data: S.AccountFields) -> Any:
    return services.update_account(ctx, account_id=account_id, data=data)


@router.delete("/accounts/{account_id}", response_model=S.Ok, dependencies=WRITE)
def delete_account(ctx: CtxDep, account_id: uuid.UUID) -> Any:
    services.delete_account(ctx, account_id=account_id)
    return S.Ok(ids=[account_id])


@router.post(
    "/accounts/{account_id}/adjust",
    response_model=S.RecordPublic | None,
    dependencies=WRITE,
)
def adjust_balance(ctx: CtxDep, account_id: uuid.UUID, data: S.AdjustBalance) -> Any:
    """FIN-12: ``null`` when the balance already matches."""
    rec = services.adjust_balance(
        ctx,
        account_id=account_id,
        actual_minor=data.actual_minor,
        note=data.note,
        record_id=data.record_id,
    )
    return services.record_public(ctx, rec) if rec else None


# ---------------------------------------------------------------------------
# Categories
# ---------------------------------------------------------------------------


@router.get("/categories", response_model=S.CategoriesPublic, dependencies=READ)
def list_categories(
    ctx: CtxDep,
    page: PaginationDep,
    kind: S.CategoryKind | None = None,
    include_archived: bool = False,
) -> Any:
    rows, count = services.list_categories(
        ctx,
        kind=kind,
        include_archived=include_archived,
        skip=page.skip,
        limit=page.limit,
    )
    return S.CategoriesPublic(
        data=[S.CategoryPublic.model_validate(c) for c in rows], count=count
    )


@router.get("/categories/suggest", dependencies=READ)
def suggest_category(
    ctx: CtxDep, payee: Annotated[str, Query(max_length=120)]
) -> dict[str, Any]:
    """FIN-15 "AI suggestion first": the category last used with this payee."""
    s = repo.load_state(ctx)
    cid = calc.suggest_category(s, payee)
    ctx.commit()
    return {"category_id": cid}


@router.get("/categories/recent", dependencies=READ)
def recent_categories(ctx: CtxDep) -> dict[str, Any]:
    """FIN-05 chips: the last category first, then the most used (30 days)."""
    st = repo.settings_row(ctx)
    s = repo.load_state(ctx, st)
    last = str(st.last_category_id) if st.last_category_id else None
    ctx.commit()
    return {"category_ids": calc.recent_categories(s, last)}


@router.post("/categories", response_model=S.CategoryPublic, dependencies=WRITE)
def add_category(ctx: CtxDep, data: S.CategoryCreate) -> Any:
    return services.add_category(ctx, data=data)


@router.patch(
    "/categories/{category_id}", response_model=S.CategoryPublic, dependencies=WRITE
)
def update_category(ctx: CtxDep, category_id: uuid.UUID, data: S.CategoryFields) -> Any:
    return services.update_category(ctx, category_id=category_id, data=data)


@router.post(
    "/categories/{category_id}/move",
    response_model=S.CategoryPublic,
    dependencies=WRITE,
)
def move_category(ctx: CtxDep, category_id: uuid.UUID, data: S.MoveCategory) -> Any:
    return services.move_sub_category(
        ctx, category_id=category_id, parent_id=data.parent_id
    )


@router.get(
    "/categories/{category_id}/uses", response_model=S.CategoryUses, dependencies=READ
)
def category_uses(ctx: CtxDep, category_id: uuid.UUID) -> Any:
    return services.category_uses(ctx, category_id=category_id)


@router.delete("/categories/{category_id}", response_model=S.Ok, dependencies=WRITE)
def delete_category(
    ctx: CtxDep, category_id: uuid.UUID, move_to: uuid.UUID | None = None
) -> Any:
    """Delete, moving records, planned items and budget scope to ``move_to``."""
    services.delete_category(ctx, category_id=category_id, move_to=move_to)
    return S.Ok(ids=[category_id])


# ---------------------------------------------------------------------------
# Records
# ---------------------------------------------------------------------------


@router.get("/records", response_model=S.RecordsPublic, dependencies=READ)
def list_records(
    ctx: CtxDep,
    page: PaginationDep,
    f: Annotated[S.RecordFilter, Query()],
) -> Any:
    """FIN-02 with the FIN-08 filter and sort; newest first by default."""
    rows, count = services.list_records(ctx, f=f, skip=page.skip, limit=page.limit)
    return S.RecordsPublic(
        data=[services.record_public(ctx, r) for r in rows], count=count
    )


@router.post("/records", response_model=S.RecordsPublic, dependencies=WRITE)
def add_record(ctx: CtxDep, data: S.RecordCreate) -> Any:
    """FIN-04/05: returns the record and, for a transfer with a fee, the fee."""
    rows = services.add_record(ctx, data=data)
    return S.RecordsPublic(
        data=[services.record_public(ctx, r) for r in rows], count=len(rows)
    )


@router.post("/records/delete", response_model=S.Ok, dependencies=WRITE)
def delete_records(ctx: CtxDep, data: S.RecordIds) -> Any:
    """Bulk delete (fees go with their transfer). Returns every id deleted,
    which is what ``/records/restore`` takes for the undo toast."""
    return S.Ok(ids=services.delete_records(ctx, record_ids=data.ids))


@router.post("/records/restore", response_model=S.Ok, dependencies=WRITE)
def restore_records(ctx: CtxDep, data: S.RecordIds) -> Any:
    return S.Ok(ids=services.restore_records(ctx, record_ids=data.ids))


@router.post(
    "/records/recategorise", response_model=S.RecordsPublic, dependencies=WRITE
)
def recategorise(ctx: CtxDep, data: S.Recategorise) -> Any:
    rows = services.recategorise(ctx, record_ids=data.ids, category_id=data.category_id)
    return S.RecordsPublic(
        data=[services.record_public(ctx, r) for r in rows], count=len(rows)
    )


@router.get("/records/{record_id}", response_model=S.RecordPublic, dependencies=READ)
def get_record(ctx: CtxDep, record_id: uuid.UUID) -> Any:
    """FIN-03."""
    return services.record_public(ctx, services._record(ctx, record_id))


@router.patch("/records/{record_id}", response_model=S.RecordPublic, dependencies=WRITE)
def update_record(ctx: CtxDep, record_id: uuid.UUID, data: S.RecordUpdate) -> Any:
    return services.record_public(
        ctx, services.update_record(ctx, record_id=record_id, data=data)
    )


@router.delete("/records/{record_id}", response_model=S.Ok, dependencies=WRITE)
def delete_record(ctx: CtxDep, record_id: uuid.UUID) -> Any:
    return S.Ok(ids=services.delete_records(ctx, record_ids=[record_id]))


@router.post(
    "/records/{record_id}/duplicate", response_model=S.RecordPublic, dependencies=WRITE
)
def duplicate_record(ctx: CtxDep, record_id: uuid.UUID, data: S.Duplicate) -> Any:
    return services.record_public(
        ctx, services.duplicate_record(ctx, record_id=record_id, new_id=data.new_id)
    )


@router.post(
    "/records/{record_id}/confirm", response_model=S.RecordPublic, dependencies=WRITE
)
def confirm_record(ctx: CtxDep, record_id: uuid.UUID) -> Any:
    """Pending review -> cleared."""
    return services.record_public(
        ctx, services.confirm_record(ctx, record_id=record_id)
    )


# ---------------------------------------------------------------------------
# Budgets
# ---------------------------------------------------------------------------


@router.get("/budgets", response_model=S.BudgetsPublic, dependencies=READ)
def list_budgets(
    ctx: CtxDep,
    page: PaginationDep,
    include_archived: bool = False,
    month: Annotated[str | None, Query(pattern=r"^\d{4}-(0[1-9]|1[0-2])$")] = None,
) -> Any:
    """FIN-16: spent, limit, pace, days left, safe per day."""
    out = services.budgets_view(ctx, include_archived=include_archived, month=month)
    out.data = _page(out.data, page.skip, page.limit)
    return out


@router.post("/budgets", response_model=S.BudgetPublic, dependencies=WRITE)
def add_budget(ctx: CtxDep, data: S.BudgetCreate) -> Any:
    return services.budget_public(ctx, services.add_budget(ctx, data=data))


@router.get("/budgets/{budget_id}", response_model=S.BudgetDetail, dependencies=READ)
def budget_detail(ctx: CtxDep, budget_id: uuid.UUID) -> Any:
    """FIN-17: this month, six past months and the 3-month average hint."""
    return services.budget_detail(ctx, budget_id=budget_id)


@router.patch("/budgets/{budget_id}", response_model=S.BudgetPublic, dependencies=WRITE)
def update_budget(ctx: CtxDep, budget_id: uuid.UUID, data: S.BudgetFields) -> Any:
    return services.budget_public(
        ctx, services.update_budget(ctx, budget_id=budget_id, data=data)
    )


@router.delete("/budgets/{budget_id}", response_model=S.Ok, dependencies=WRITE)
def delete_budget(ctx: CtxDep, budget_id: uuid.UUID) -> Any:
    services.delete_budget(ctx, budget_id=budget_id)
    return S.Ok(ids=[budget_id])


@router.get("/budgets-average", dependencies=READ)
def budget_average(
    ctx: CtxDep, category_ids: Annotated[list[uuid.UUID] | None, Query()] = None
) -> dict[str, int]:
    """FIN-18 limit hint: the 3-month average spend of a scope."""
    s = repo.load_state(ctx)
    ids = [str(x) for x in category_ids or []] or None
    ctx.commit()
    return {"avg3_minor": calc.js_round(calc.avg_spend(s, ids))}


# ---------------------------------------------------------------------------
# Planned items and occurrences
# ---------------------------------------------------------------------------


@router.get("/planned", response_model=S.PlannedList, dependencies=READ)
def list_planned(
    ctx: CtxDep,
    page: PaginationDep,
    tab: Literal["recurring", "one-off", "what-if"] | None = None,
    include_archived: bool = False,
) -> Any:
    """FIN-19 with its tabs and the monthly totals in and out."""
    return services.list_planned(
        ctx,
        tab=tab,
        include_archived=include_archived,
        skip=page.skip,
        limit=page.limit,
    )


@router.post("/planned", response_model=S.PlannedPublic, dependencies=WRITE)
def add_planned(ctx: CtxDep, data: S.PlannedCreate) -> Any:
    p = services.add_planned(ctx, data=data)
    return services.planned_detail(ctx, planned_id=p.id)


@router.get("/planned/due", response_model=S.OccurrencesPublic, dependencies=READ)
def due(ctx: CtxDep) -> Any:
    """Today cards: overdue (two weeks back) and due today or tomorrow."""
    return services.due_view(ctx)


@router.post("/planned/settle", response_model=S.RecordPublic, dependencies=WRITE)
def settle(ctx: CtxDep, data: S.Settle) -> Any:
    """FIN-22 Paid."""
    rec = services.settle_occurrence(
        ctx,
        planned_id=data.planned_id,
        day=data.day,
        amount_minor=data.amount_minor,
        account_id=data.account_id,
        on=data.paid_on,
    )
    return services.record_public(ctx, rec)


@router.post("/planned/skip", response_model=S.Ok, dependencies=WRITE)
def skip(ctx: CtxDep, data: S.OccurrenceRef) -> Any:
    row = services.skip_occurrence(ctx, planned_id=data.planned_id, day=data.day)
    return S.Ok(ids=[row.id])


@router.post("/planned/unskip", response_model=S.Ok, dependencies=WRITE)
def unskip(ctx: CtxDep, data: S.OccurrenceRef) -> Any:
    services.unskip_occurrence(ctx, planned_id=data.planned_id, day=data.day)
    return S.Ok()


@router.post("/planned/snooze", dependencies=WRITE)
def snooze(ctx: CtxDep, data: S.Snooze) -> dict[str, Any]:
    row = services.snooze_occurrence(
        ctx, planned_id=data.planned_id, day=data.day, days=data.days
    )
    return {"id": str(row.id), "until_day": row.until_day.isoformat()}


@router.post("/planned/auto-log", response_model=S.RecordsPublic, dependencies=WRITE)
def auto_log(ctx: CtxDep) -> Any:
    """F-FIN-22: materialise due auto-log items on app open."""
    rows = services.auto_log_due(ctx)
    return S.RecordsPublic(
        data=[services.record_public(ctx, r) for r in rows], count=len(rows)
    )


@router.get("/planned/{planned_id}", response_model=S.PlannedPublic, dependencies=READ)
def planned_detail(ctx: CtxDep, planned_id: uuid.UUID) -> Any:
    """FIN-20 (its occurrences: ``/occurrences?planned_id=``)."""
    return services.planned_detail(ctx, planned_id=planned_id)


@router.patch(
    "/planned/{planned_id}", response_model=S.PlannedPublic, dependencies=WRITE
)
def update_planned(ctx: CtxDep, planned_id: uuid.UUID, data: S.PlannedFields) -> Any:
    services.update_planned(ctx, planned_id=planned_id, data=data)
    return services.planned_detail(ctx, planned_id=planned_id)


@router.delete("/planned/{planned_id}", response_model=S.Ok, dependencies=WRITE)
def delete_planned(ctx: CtxDep, planned_id: uuid.UUID) -> Any:
    services.delete_planned(ctx, planned_id=planned_id)
    return S.Ok(ids=[planned_id])


@router.get("/occurrences", response_model=S.OccurrencesPublic, dependencies=READ)
def occurrences(
    ctx: CtxDep,
    first: date,
    last: date,
    include_what_if: bool = False,
    planned_id: uuid.UUID | None = None,
) -> Any:
    """Occurrences with status (paid, skipped, due, upcoming, overdue)."""
    return services.occurrences_view(
        ctx,
        first=first,
        last=last,
        include_what_if=include_what_if,
        planned_id=planned_id,
    )


# ---------------------------------------------------------------------------
# Projection, reports, review
# ---------------------------------------------------------------------------


@router.get("/projection", response_model=S.ProjectionOut, dependencies=READ)
def projection_default(ctx: CtxDep) -> Any:
    """FIN-23 with the saved assumptions."""
    return services.projection(ctx, data=S.ProjectionIn())


@router.post("/projection", response_model=S.ProjectionOut, dependencies=READ)
def projection(ctx: CtxDep, data: S.ProjectionIn) -> Any:
    """FIN-23/24: a scenario (what-if, exclusions, horizon). Read-only."""
    return services.projection(ctx, data=data)


@router.get("/reports", response_model=S.ReportOut, dependencies=READ)
def report(ctx: CtxDep, period: Literal["this", "last", "3m"] = "this") -> Any:
    """FIN-30/31."""
    return services.report(ctx, period=period)


@router.get("/review", response_model=S.LookbackOut, dependencies=READ)
def review(
    ctx: CtxDep,
    period: Annotated[str | None, Query(pattern=r"^\d{4}-(0[1-9]|1[0-2])$")] = None,
    first: date | None = None,
    last: date | None = None,
) -> Any:
    """FIN-32 for a month (default: last month) or a custom range."""
    return services.lookback_view(ctx, period=period, first=first, last=last)


@router.post("/review", response_model=S.LookBackPublic, dependencies=WRITE)
def save_review(ctx: CtxDep, data: S.LookBackSave) -> Any:
    return services.save_look_back(ctx, data=data)


@router.get("/look-backs", response_model=S.LookBacksPublic, dependencies=READ)
def list_look_backs(ctx: CtxDep, page: PaginationDep) -> Any:
    rows = owned_repo.list_rows(
        ctx,
        LookBack,
        order_by=[col(LookBack.period).desc()],
        skip=page.skip,
        limit=page.limit,
    )
    return S.LookBacksPublic(
        data=[S.LookBackPublic.model_validate(r) for r in rows],
        count=owned_repo.count_rows(ctx, LookBack),
    )


# ---------------------------------------------------------------------------
# Statement import
# ---------------------------------------------------------------------------


@router.get("/imports", response_model=S.ImportsPublic, dependencies=READ)
def list_imports(
    ctx: CtxDep, page: PaginationDep, account_id: uuid.UUID | None = None
) -> Any:
    """FIN-29: drafts first."""
    rows, count = imports.list_imports(
        ctx, account_id=account_id, skip=page.skip, limit=page.limit
    )
    return S.ImportsPublic(
        data=[S.ImportPublic.model_validate(r) for r in rows], count=count
    )


@router.post("/imports", response_model=S.ImportPublic, dependencies=WRITE)
def start_import(ctx: CtxDep, data: S.ImportStart) -> Any:
    """FIN-25."""
    return imports.start_import(ctx, data=data)


@router.get("/imports/{import_id}", response_model=S.ImportDetail, dependencies=READ)
def import_detail(ctx: CtxDep, import_id: uuid.UUID) -> Any:
    """FIN-27 review: rows, needs-attention flags and the balance check."""
    return imports.import_detail(ctx, import_id=import_id)


@router.post(
    "/imports/{import_id}/csv", response_model=S.ImportPublic, dependencies=WRITE
)
def import_csv(ctx: CtxDep, import_id: uuid.UUID, data: S.CsvIn) -> Any:
    """FIN-26: parse a CSV (generic mapping, GCash or BPI layout)."""
    return imports.ingest_csv(ctx, import_id=import_id, data=data)


@router.post(
    "/imports/{import_id}/rows", response_model=S.ImportPublic, dependencies=WRITE
)
def import_rows(ctx: CtxDep, import_id: uuid.UUID, data: S.ExtractedIn) -> Any:
    """FIN-26: rows a vision/OCR step read from a PDF or screenshot."""
    return imports.ingest_rows(ctx, import_id=import_id, data=data)


@router.post(
    "/imports/{import_id}/fail", response_model=S.ImportPublic, dependencies=WRITE
)
def import_fail(ctx: CtxDep, import_id: uuid.UUID, data: S.ImportFail) -> Any:
    return imports.fail_import(ctx, import_id=import_id, error_code=data.error_code)


@router.post(
    "/imports/{import_id}/retry", response_model=S.ImportPublic, dependencies=WRITE
)
def import_retry(ctx: CtxDep, import_id: uuid.UUID) -> Any:
    return imports.retry_import(ctx, import_id=import_id)


@router.patch(
    "/imports/{import_id}/rows",
    response_model=list[S.ImportRowPublic],
    dependencies=WRITE,
)
def patch_rows(ctx: CtxDep, import_id: uuid.UUID, data: S.RowPatch) -> Any:
    """FIN-27/28: bulk accept, set category, ignore, keep/take/merge, re-match."""
    rows = imports.patch_rows(ctx, import_id=import_id, data=data)
    return [S.ImportRowPublic.model_validate(r) for r in rows]


@router.post(
    "/imports/{import_id}/commit", response_model=S.CommitOut, dependencies=WRITE
)
def import_commit(ctx: CtxDep, import_id: uuid.UUID, data: S.CommitIn) -> Any:
    return imports.commit_import(ctx, import_id=import_id, data=data)


@router.post(
    "/imports/{import_id}/undo", response_model=S.ImportPublic, dependencies=WRITE
)
def import_undo(ctx: CtxDep, import_id: uuid.UUID) -> Any:
    return imports.undo_import(ctx, import_id=import_id)


@router.delete("/imports/{import_id}", response_model=S.Ok, dependencies=WRITE)
def import_delete(ctx: CtxDep, import_id: uuid.UUID) -> Any:
    imports.delete_import(ctx, import_id=import_id)
    return S.Ok(ids=[import_id])


@router.post(
    "/imports/{import_id}/restore", response_model=S.ImportPublic, dependencies=WRITE
)
def import_restore(ctx: CtxDep, import_id: uuid.UUID) -> Any:
    return imports.restore_import(ctx, import_id=import_id)


@router.post(
    "/imports/{import_id}/discard-file",
    response_model=S.ImportPublic,
    dependencies=WRITE,
)
def import_discard_file(ctx: CtxDep, import_id: uuid.UUID) -> Any:
    return imports.discard_file(ctx, import_id=import_id)


# ---------------------------------------------------------------------------
# Advisor
# ---------------------------------------------------------------------------


@router.get("/advisor/threads", response_model=S.ThreadsPublic, dependencies=READ)
def list_threads(ctx: CtxDep, page: PaginationDep) -> Any:
    rows, count = services.list_threads(ctx, skip=page.skip, limit=page.limit)
    return S.ThreadsPublic(
        data=[S.ThreadPublic.model_validate(t) for t in rows], count=count
    )


@router.post("/advisor/threads", response_model=S.ThreadPublic, dependencies=WRITE)
def create_thread(ctx: CtxDep, data: S.ThreadCreate) -> Any:
    return services.create_thread(ctx, data=data)


@router.get(
    "/advisor/threads/{thread_id}", response_model=S.ThreadDetail, dependencies=READ
)
def thread_detail(ctx: CtxDep, thread_id: uuid.UUID) -> Any:
    thread, msgs = services.thread_messages(ctx, thread_id=thread_id)
    return S.ThreadDetail(
        **S.ThreadPublic.model_validate(thread).model_dump(),
        messages=[S.MessagePublic.model_validate(m) for m in msgs],
    )


@router.patch(
    "/advisor/threads/{thread_id}", response_model=S.ThreadPublic, dependencies=WRITE
)
def rename_thread(ctx: CtxDep, thread_id: uuid.UUID, data: S.ThreadUpdate) -> Any:
    return services.rename_thread(ctx, thread_id=thread_id, title=data.title)


@router.delete("/advisor/threads/{thread_id}", response_model=S.Ok, dependencies=WRITE)
def delete_thread(ctx: CtxDep, thread_id: uuid.UUID) -> Any:
    services.delete_thread(ctx, thread_id=thread_id)
    return S.Ok(ids=[thread_id])


@router.post(
    "/advisor/threads/{thread_id}/messages",
    response_model=S.MessagePublic,
    dependencies=WRITE,
)
def add_message(ctx: CtxDep, thread_id: uuid.UUID, data: S.MessageCreate) -> Any:
    return services.add_message(ctx, thread_id=thread_id, data=data)


@router.delete(
    "/advisor/threads/{thread_id}/messages/{message_id}",
    response_model=S.Ok,
    dependencies=WRITE,
)
def delete_message(ctx: CtxDep, thread_id: uuid.UUID, message_id: uuid.UUID) -> Any:
    services.delete_message(ctx, thread_id=thread_id, message_id=message_id)
    return S.Ok(ids=[message_id])


@router.post("/advisor/threads/{thread_id}/ask/stream", dependencies=WRITE)
def advisor_ask_stream(ctx: CtxDep, thread_id: uuid.UUID, data: AdvisorAskIn) -> Any:
    """Ask the advisor in a thread; the answer streams as SSE (AI when the
    user's advisor model resolves, else the deterministic answer)."""
    from app.modules.finance import advisor_ai

    return advisor_ai.stream(ctx, thread_id=thread_id, data=data)


@router.post("/advisor/answer", dependencies=READ)
def advisor_answer(ctx: CtxDep, data: S.AdviceIn) -> dict[str, Any]:
    """The deterministic answer for a question (the AI answer's fallback)."""
    st = repo.settings_row(ctx)
    s = repo.load_state(ctx, st)
    out = advisor.answer(
        s,
        advisor.advisor_question(data.text),
        scope=data.scope,
        safety_floor_minor=st.safety_floor_minor,
    )
    ctx.commit()
    return out
