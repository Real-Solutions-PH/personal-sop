"""REST routes of the tasks module: one endpoint per screen action
(TSK-01 … TSK-18). Static paths are declared before ``/{task_id}``."""

import uuid
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Query

from app.modules.iam.deps import require_permission
from app.modules.tasks import ops, repo, services
from app.modules.tasks.schema import (
    ArchiveIn,
    CaptureIn,
    CaptureResult,
    CompletedPublic,
    CompleteIn,
    CompleteResult,
    CountResult,
    DeleteMode,
    DueIn,
    IdsIn,
    IdsResult,
    ListCreate,
    ListPublic,
    ListsPublic,
    ListUpdate,
    MoveListIn,
    MoveTaskIn,
    NotifPublic,
    NotifUpdate,
    OverduePublic,
    ParseIn,
    ParsePublic,
    RescheduleIn,
    SettingsPublic,
    SettingsUpdate,
    SharePublic,
    SnoozeIn,
    StatsPair,
    TaskCreate,
    TaskDetail,
    TaskPublic,
    TasksCreate,
    TasksPublic,
    TaskUpdate,
    TodayPublic,
)
from app.shared.context import CtxDep
from app.shared.pagination import PaginationDep
from app.shared.rate_limit import rate_limited
from app.shared.schema import Message

router = APIRouter(prefix="/tasks", tags=["tasks"])

READ = [Depends(require_permission("tasks:read"))]
WRITE = [rate_limited("tasks"), Depends(require_permission("tasks:write"))]

Days = Annotated[int, Query(ge=1, le=366)]


# ---------------------------------------------------------------- reads


@router.get("/today", response_model=TodayPublic, dependencies=READ)
def today(ctx: CtxDep) -> Any:
    """TSK-01 smart views and the TSK-16 Today card."""
    return services.today(ctx)


def _filter(
    list_id: uuid.UUID | None = None,
    inbox: bool = False,
    status: repo.StatusFilter = "open",
    starred: bool = False,
    overdue: bool = False,
    has_date: bool = False,
    q: Annotated[str, Query(max_length=200)] = "",
    sort: repo.Sort = "due",
) -> repo.TaskFilter:
    return repo.TaskFilter(
        list_id=list_id,
        inbox=inbox,
        status=status,
        starred=starred,
        overdue=overdue,
        has_date=has_date,
        q=q,
        sort=sort,
    )


FilterDep = Annotated[repo.TaskFilter, Depends(_filter)]


@router.get("/", response_model=TasksPublic, dependencies=READ)
def list_tasks(ctx: CtxDep, f: FilterDep, page: PaginationDep) -> Any:
    """TSK-02 list detail (``list_id`` / ``inbox``) and any filtered view."""
    return services.find_tasks(ctx, f=f, skip=page.skip, limit=page.limit)


@router.get("/search", response_model=TasksPublic, dependencies=READ)
def search(ctx: CtxDep, f: FilterDep, page: PaginationDep) -> Any:
    """TSK-09 search & filter: title and notes, the same query as the lists."""
    return services.find_tasks(ctx, f=f, skip=page.skip, limit=page.limit)


@router.get("/completed", response_model=CompletedPublic, dependencies=READ)
def completed(ctx: CtxDep, page: PaginationDep, days: Days = 14) -> Any:
    """TSK-10 completed log, grouped by business day (newest first)."""
    return services.completed(ctx, days=days, skip=page.skip, limit=page.limit)


@router.get("/deleted", response_model=TasksPublic, dependencies=READ)
def recently_deleted(ctx: CtxDep, page: PaginationDep) -> Any:
    """TSK-10 Recently deleted (30 days)."""
    return services.recently_deleted(ctx, skip=page.skip, limit=page.limit)


@router.get("/overdue", response_model=OverduePublic, dependencies=READ)
def overdue(ctx: CtxDep) -> Any:
    """TSK-11 overdue triage with days late."""
    return services.overdue(ctx)


@router.get("/stats", response_model=StatsPair, dependencies=READ)
def stats(ctx: CtxDep, days: Days = 7) -> Any:
    """TSK-17 task stats for a range, with the previous range for deltas."""
    return services.stats(ctx, days=days)


@router.get("/share", response_model=SharePublic, dependencies=READ)
def share(ctx: CtxDep, days: Annotated[int, Query()] = 7) -> Any:
    """TSK-18 share-card data (ranges 7, 30, 90)."""
    return services.share(ctx, days=days if days in (7, 30, 90) else 7)


@router.post("/parse", response_model=ParsePublic, dependencies=READ)
def parse(ctx: CtxDep, body: ParseIn) -> Any:
    """TSK-04 inline date highlight (the device parses offline too)."""
    return services.parse(ctx, text=body.text)


# ---------------------------------------------------------------- settings


@router.get("/settings", response_model=SettingsPublic, dependencies=READ)
def get_settings(ctx: CtxDep) -> Any:
    """TSK-13 task settings."""
    return services.get_settings(ctx)


@router.patch("/settings", response_model=SettingsPublic, dependencies=WRITE)
def update_settings(ctx: CtxDep, body: SettingsUpdate) -> Any:
    return services.update_settings(ctx, patch=body.model_dump(exclude_unset=True))


@router.get("/notif", response_model=NotifPublic, dependencies=READ)
def get_notif(ctx: CtxDep) -> Any:
    """TSK-12 reminders setup state (install guide, permission, test ping)."""
    return services.get_notif(ctx)


@router.patch("/notif", response_model=NotifPublic, dependencies=WRITE)
def update_notif(ctx: CtxDep, body: NotifUpdate) -> Any:
    return services.update_notif(ctx, patch=body.model_dump(exclude_unset=True))


# ---------------------------------------------------------------- lists


@router.get("/lists", response_model=ListsPublic, dependencies=READ)
def lists(ctx: CtxDep, include_archived: bool = False) -> Any:
    """TSK-01 lists with open counts; TSK-08 manage lists (archived too)."""
    return services.lists(ctx, include_archived=include_archived)


@router.post("/lists", response_model=ListPublic, dependencies=WRITE)
def create_list(ctx: CtxDep, body: ListCreate) -> Any:
    """TSK-07 create a list."""
    return services.create_list(ctx, inp=body)


@router.post("/lists/defaults", response_model=ListsPublic, dependencies=WRITE)
def ensure_default_lists(ctx: CtxDep) -> Any:
    """First run: seed Work, Life and Groceries (once per user)."""
    return services.ensure_default_lists(ctx)


@router.get("/lists/{list_id}", response_model=ListPublic, dependencies=READ)
def get_list(ctx: CtxDep, list_id: uuid.UUID) -> Any:
    return services.get_list(ctx, list_id=list_id)


@router.patch("/lists/{list_id}", response_model=ListPublic, dependencies=WRITE)
def update_list(ctx: CtxDep, list_id: uuid.UUID, body: ListUpdate) -> Any:
    """TSK-07 rename, recolour, shopping-mode toggle."""
    return services.update_list(
        ctx, list_id=list_id, patch=body.model_dump(exclude_unset=True)
    )


@router.post("/lists/{list_id}/archive", response_model=ListPublic, dependencies=WRITE)
def archive_list(ctx: CtxDep, list_id: uuid.UUID, body: ArchiveIn) -> Any:
    """TSK-07/08 archive or unarchive."""
    return services.set_list_archived(ctx, list_id=list_id, archived=body.archived)


@router.delete("/lists/{list_id}", response_model=CountResult, dependencies=WRITE)
def delete_list(ctx: CtxDep, list_id: uuid.UUID, mode: DeleteMode = "inbox") -> Any:
    """TSK-07 delete: open tasks move to the Inbox, or are deleted."""
    return CountResult(count=services.delete_list(ctx, list_id=list_id, mode=mode))


@router.post("/lists/{list_id}/move", response_model=ListsPublic, dependencies=WRITE)
def move_list(ctx: CtxDep, list_id: uuid.UUID, body: MoveListIn) -> Any:
    """TSK-08 reorder lists."""
    return services.move_list(ctx, list_id=list_id, step=body.dir)


@router.post(
    "/lists/{list_id}/clear-checked", response_model=IdsResult, dependencies=WRITE
)
def clear_checked(ctx: CtxDep, list_id: uuid.UUID) -> Any:
    """TSK-02 shopping mode: clear checked items (undo with ``/unclear``)."""
    return IdsResult(ids=services.clear_checked(ctx, list_id=list_id))


# ---------------------------------------------------------------- create


@router.post("/", response_model=TaskPublic, dependencies=WRITE)
def create_task(ctx: CtxDep, body: TaskCreate) -> Any:
    """TSK-04 quick-add (client id optional; a replay returns the row)."""
    return services.create_task(ctx, inp=body)


@router.post("/batch", response_model=TasksPublic, dependencies=WRITE)
def create_tasks(ctx: CtxDep, body: TasksCreate) -> Any:
    rows = services.create_tasks(ctx, inps=body.tasks)
    return TasksPublic(data=[services.task_public(t) for t in rows], count=len(rows))


@router.post("/capture", response_model=CaptureResult, dependencies=WRITE)
def capture(ctx: CtxDep, body: CaptureIn) -> Any:
    """TSK-14 capture: split a brain-dump into tasks and route each to a list."""
    return services.capture(ctx, text=body.text, source=body.source)


@router.post("/remove", response_model=Message, dependencies=WRITE)
def remove_tasks(ctx: CtxDep, body: IdsIn) -> Any:
    """TSK-14 undo capture (all or one row): the tasks never happened."""
    services.remove_tasks(ctx, task_ids=body.ids)
    return Message(message="Removed")


@router.post("/unclear", response_model=IdsResult, dependencies=WRITE)
def unclear(ctx: CtxDep, body: IdsIn) -> Any:
    """Undo of clear-checked."""
    return IdsResult(ids=services.unclear(ctx, task_ids=body.ids))


@router.post("/overdue/move-to-today", response_model=CountResult, dependencies=WRITE)
def move_overdue_to_today(ctx: CtxDep) -> Any:
    """TSK-11 move all overdue to today (one reschedule each)."""
    return CountResult(count=services.move_overdue_to_today(ctx))


# ---------------------------------------------------------------- one task


@router.get("/{task_id}", response_model=TaskDetail, dependencies=READ)
def get_task(ctx: CtxDep, task_id: uuid.UUID) -> Any:
    """TSK-03 task detail."""
    return services.get_task(ctx, task_id=task_id)


@router.patch("/{task_id}", response_model=TaskPublic, dependencies=WRITE)
def update_task(ctx: CtxDep, task_id: uuid.UUID, body: TaskUpdate) -> Any:
    """TSK-03 autosave: title, notes, list, star, repeat, reminder, time."""
    patch = body.model_dump(exclude_unset=True)
    if "recurrence" in patch and body.recurrence is not None:
        patch["recurrence"] = body.recurrence.model_dump()
    return services.update(ctx, task_id=task_id, patch=patch)


@router.put("/{task_id}/due", response_model=TaskPublic, dependencies=WRITE)
def set_due(ctx: CtxDep, task_id: uuid.UUID, body: DueIn) -> Any:
    """TSK-05 date/time/reminder picker. A later date is a reschedule."""
    sent = body.model_fields_set
    return services.set_due(
        ctx,
        task_id=task_id,
        due_date=body.due_date,
        due_time=body.due_time if "due_time" in sent else ops.UNSET,
        remind_at=body.remind_at if "remind_at" in sent else ops.UNSET,
    )


@router.post("/{task_id}/complete", response_model=CompleteResult, dependencies=WRITE)
def complete(ctx: CtxDep, task_id: uuid.UUID, body: CompleteIn | None = None) -> Any:
    """F-TSK-08 tick. A recurring task returns its next occurrence."""
    return services.complete(
        ctx, task_id=task_id, completed_at=body.completed_at if body else None
    )


@router.post("/{task_id}/uncomplete", response_model=TaskPublic, dependencies=WRITE)
def uncomplete(ctx: CtxDep, task_id: uuid.UUID) -> Any:
    return services.uncomplete(ctx, task_id=task_id)


@router.post("/{task_id}/toggle", response_model=CompleteResult, dependencies=WRITE)
def toggle(ctx: CtxDep, task_id: uuid.UUID) -> Any:
    return services.toggle(ctx, task_id=task_id)


@router.post("/{task_id}/reschedule", response_model=TaskPublic, dependencies=WRITE)
def reschedule(ctx: CtxDep, task_id: uuid.UUID, body: RescheduleIn) -> Any:
    """Swipe / triage: Today (0), Tomorrow (1), +n days."""
    return services.reschedule_by(ctx, task_id=task_id, days=body.days)


@router.post("/{task_id}/snooze", response_model=TaskPublic, dependencies=WRITE)
def snooze(ctx: CtxDep, task_id: uuid.UUID, body: SnoozeIn) -> Any:
    """F-TSK-37 snooze the reminder (not a reschedule)."""
    return services.snooze(ctx, task_id=task_id, minutes=body.minutes)


@router.post("/{task_id}/duplicate", response_model=TaskPublic, dependencies=WRITE)
def duplicate(ctx: CtxDep, task_id: uuid.UUID, new_id: uuid.UUID | None = None) -> Any:
    """F-TSK-17 duplicate (a past due date is dropped)."""
    return services.duplicate(ctx, task_id=task_id, new_id=new_id)


@router.post("/{task_id}/restore", response_model=TaskPublic, dependencies=WRITE)
def restore(ctx: CtxDep, task_id: uuid.UUID) -> Any:
    """F-TSK-19 restore from Recently deleted (or the undo toast)."""
    return services.restore(ctx, task_id=task_id)


@router.post("/{task_id}/move", response_model=Message, dependencies=WRITE)
def move(ctx: CtxDep, task_id: uuid.UUID, body: MoveTaskIn) -> Any:
    """F-TSK-20 manual reorder within the visible order."""
    services.move(ctx, task_id=task_id, step=body.dir, ids=body.ids)
    return Message(message="Moved")


@router.delete("/{task_id}", response_model=TaskPublic, dependencies=WRITE)
def delete_task(ctx: CtxDep, task_id: uuid.UUID) -> Any:
    """F-TSK-18 soft delete (undo with ``/restore``)."""
    return services.delete(ctx, task_id=task_id)
