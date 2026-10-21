"""Queries of the tasks module. Ownership-filtered through ``owned_repo``;
nothing here commits."""

import uuid
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from typing import Any, Literal

from sqlalchemy import ColumnElement, func, or_
from sqlmodel import col, select

from app.modules.tasks.logic import EventView, ListView, TasksState, TaskView
from app.modules.tasks.models import (
    Task,
    TaskEvent,
    TaskList,
    TaskNotifState,
    TaskSettings,
)
from app.shared import owned_repo
from app.shared.context import Ctx
from app.shared.domain import not_found
from app.shared.ids import derived_id

# The prototype's defaults (``seedTasks().settings``). The table's column
# defaults differ (digest on, groceries not counted); the ratified behaviour
# is the prototype's, so every row this module creates is written with these.
SETTINGS_DEFAULTS: dict[str, Any] = {
    "default_remind_time": "09:00",
    "digest_on": False,
    "digest_time": "07:30",
    "quiet_start": "22:00",
    "quiet_end": "07:00",
    "count_groceries": True,
    "week_start": 1,
}
NOTIF_DEFAULTS: dict[str, Any] = {
    "platform": "ios",
    "installed": False,
    "permission": "default",
    "remind_later_at": None,
    "test_sent_at": None,
}
RECENTLY_DELETED_DAYS = 30

Sort = Literal["due", "created", "manual"]
StatusFilter = Literal["open", "done", "all"]


def settings_id(ctx: Ctx) -> uuid.UUID:
    return derived_id("task-settings", ctx.user_id, "settings")


def notif_id(ctx: Ctx) -> uuid.UUID:
    return derived_id("task-notif", ctx.user_id, "notif")


def settings_row(ctx: Ctx) -> TaskSettings | None:
    return owned_repo.find_one(ctx, TaskSettings, include_deleted=True)


def settings_or_default(ctx: Ctx) -> TaskSettings:
    """The stored settings, or an unsaved row holding the defaults."""
    row = settings_row(ctx)
    if row is not None:
        return row
    return TaskSettings(id=settings_id(ctx), **ctx.owned(), **SETTINGS_DEFAULTS)


def notif_or_default(ctx: Ctx) -> TaskNotifState:
    row = owned_repo.find_one(ctx, TaskNotifState, include_deleted=True)
    if row is not None:
        return row
    return TaskNotifState(id=notif_id(ctx), **ctx.owned(), **NOTIF_DEFAULTS)


# ---------------------------------------------------------------- tasks


def live_task(ctx: Ctx, task_id: uuid.UUID) -> Task:
    return owned_repo.require(ctx, Task, task_id, what="task")


def soft_deleted_task(ctx: Ctx, task_id: uuid.UUID) -> Task:
    """A task in Recently deleted (status ``deleted``). A task removed by
    capture undo is tombstoned with its status kept and stays a 404."""
    row = owned_repo.get(ctx, Task, task_id, include_deleted=True)
    if row is None or (row.deleted_at is not None and row.status != "deleted"):
        raise not_found("task")
    return row


def live_list(ctx: Ctx, list_id: uuid.UUID) -> TaskList:
    return owned_repo.require(ctx, TaskList, list_id, what="task_list")


def tasks_by_ids(ctx: Ctx, ids: Sequence[uuid.UUID]) -> list[Task]:
    if not ids:
        return []
    return owned_repo.list_rows(ctx, Task, col(Task.id).in_(list(ids)))


def next_order(ctx: Ctx) -> int:
    v = ctx.session.exec(
        select(func.max(Task.sort_order)).where(
            Task.owner_id == ctx.user_id, Task.tenant_id == ctx.tenant_id
        )
    ).one()
    return 0 if v is None else int(v) + 1


def children(ctx: Ctx, parent_id: uuid.UUID) -> list[Task]:
    """Live occurrences spawned from ``parent_id`` by recurrence."""
    return owned_repo.list_rows(
        ctx, Task, col(Task.series_parent_id) == parent_id, order_by=[Task.created_at]
    )


def event_types(ctx: Ctx, task_id: uuid.UUID) -> list[str]:
    return [
        e.type
        for e in owned_repo.list_rows(ctx, TaskEvent, col(TaskEvent.task_id) == task_id)
    ]


def overdue_open(ctx: Ctx, today: date) -> list[Task]:
    return owned_repo.list_rows(
        ctx,
        Task,
        col(Task.status) == "open",
        col(Task.due_date).is_not(None),
        col(Task.due_date) < today,
        order_by=[col(Task.due_date), col(Task.sort_order)],
    )


def _escape_like(q: str) -> str:
    return q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


@dataclass(frozen=True)
class TaskFilter:
    list_id: uuid.UUID | None = None
    inbox: bool = False
    status: StatusFilter = "open"
    starred: bool = False
    overdue: bool = False
    has_date: bool = False
    q: str = ""
    sort: Sort = "due"


def _filter_where(f: TaskFilter, today: date) -> list[ColumnElement[bool]]:
    where: list[ColumnElement[bool]] = [col(Task.status) != "deleted"]
    if f.status != "all":
        where.append(col(Task.status) == f.status)
    if f.inbox:
        where.append(col(Task.list_id).is_(None))
    elif f.list_id is not None:
        where.append(col(Task.list_id) == f.list_id)
    if f.starred:
        where.append(col(Task.starred).is_(True))
    if f.overdue:
        where.extend(
            [
                col(Task.status) == "open",
                col(Task.due_date).is_not(None),
                col(Task.due_date) < today,
            ]
        )
    if f.has_date:
        where.append(col(Task.due_date).is_not(None))
    q = f.q.strip()
    if q:
        pattern = f"%{_escape_like(q)}%"
        where.append(
            or_(
                col(Task.title).ilike(pattern, escape="\\"),
                col(Task.notes).ilike(pattern, escape="\\"),
            )
        )
    return where


def _order(sort: Sort) -> list[Any]:
    if sort == "created":
        return [col(Task.created_at).desc(), col(Task.id)]
    if sort == "manual":
        return [col(Task.sort_order), col(Task.id)]
    # ``byDue``: date (none last), starred first, time (none last), order.
    return [
        col(Task.due_date).asc().nulls_last(),
        col(Task.starred).desc(),
        col(Task.due_time).asc().nulls_last(),
        col(Task.sort_order),
        col(Task.id),
    ]


def find_tasks(
    ctx: Ctx, f: TaskFilter, *, skip: int, limit: int
) -> tuple[list[Task], int]:
    """One query behind the list screens and search."""
    where = _filter_where(f, ctx.today)
    rows = owned_repo.list_rows(
        ctx, Task, *where, order_by=_order(f.sort), skip=skip, limit=limit
    )
    return rows, owned_repo.count_rows(ctx, Task, *where)


def completed_since(
    ctx: Ctx, first: date, *, skip: int, limit: int
) -> tuple[list[Task], int]:
    start = ctx.clock.start_of(first)
    where: list[ColumnElement[bool]] = [
        col(Task.status) == "done",
        col(Task.completed_at) >= start,
    ]
    rows = owned_repo.list_rows(
        ctx,
        Task,
        *where,
        order_by=[col(Task.completed_at).desc(), col(Task.id)],
        skip=skip,
        limit=limit,
    )
    return rows, owned_repo.count_rows(ctx, Task, *where)


def recently_deleted(ctx: Ctx, *, skip: int, limit: int) -> tuple[list[Task], int]:
    since = ctx.now - timedelta(days=RECENTLY_DELETED_DAYS)
    where: list[ColumnElement[bool]] = [
        col(Task.status) == "deleted",
        col(Task.deleted_at) >= since,
    ]
    base = select(Task).where(
        Task.owner_id == ctx.user_id, Task.tenant_id == ctx.tenant_id, *where
    )
    rows = list(
        ctx.session.exec(
            base.order_by(col(Task.deleted_at).desc(), col(Task.id))
            .offset(skip)
            .limit(limit)
        ).all()
    )
    count = ctx.session.exec(
        select(func.count())
        .select_from(Task)
        .where(Task.owner_id == ctx.user_id, Task.tenant_id == ctx.tenant_id, *where)
    ).one()
    return rows, int(count)


def find_open(ctx: Ctx, query: str, *, limit: int) -> list[Task]:
    f = TaskFilter(status="open", q=query)
    rows, _ = find_tasks(ctx, f, skip=0, limit=limit)
    return rows


def open_counts(ctx: Ctx) -> dict[uuid.UUID, int]:
    rows = ctx.session.exec(
        select(Task.list_id, func.count())
        .where(
            Task.owner_id == ctx.user_id,
            Task.tenant_id == ctx.tenant_id,
            col(Task.deleted_at).is_(None),
            Task.status == "open",
            col(Task.list_id).is_not(None),
        )
        .group_by(col(Task.list_id))
    ).all()
    return {lid: int(n) for lid, n in rows if lid is not None}


def lists(ctx: Ctx, *, include_archived: bool = True) -> list[TaskList]:
    where: list[ColumnElement[bool]] = []
    if not include_archived:
        where.append(col(TaskList.archived_at).is_(None))
    return owned_repo.list_rows(
        ctx,
        TaskList,
        *where,
        order_by=[col(TaskList.sort_order), col(TaskList.created_at)],
    )


def any_list_ever(ctx: Ctx) -> bool:
    return owned_repo.find_one(ctx, TaskList, include_deleted=True) is not None


# ---------------------------------------------------------------- state


def _uid(v: uuid.UUID | None) -> str | None:
    return None if v is None else str(v)


def task_view(t: Task) -> TaskView:
    return TaskView(
        id=str(t.id),
        title=t.title,
        list_id=_uid(t.list_id),
        status=t.status,
        created_at=t.created_at,
        due_date=t.due_date,
        due_time=t.due_time,
        remind_at=t.remind_at,
        recurrence=t.recurrence,
        starred=t.starred,
        completed_at=t.completed_at,
        deleted_at=t.deleted_at,
        source=t.source,
        original_due=t.original_due,
        reschedule_count=t.reschedule_count,
        order=t.sort_order,
        notes=t.notes,
    )


def list_view(lst: TaskList) -> ListView:
    return ListView(
        id=str(lst.id),
        name=lst.name,
        kind=lst.kind,
        sort_order=lst.sort_order,
        archived=lst.archived_at is not None,
    )


@dataclass(frozen=True)
class Loaded:
    state: TasksState
    rows: dict[str, Task]
    lists: list[TaskList]


def load_state(ctx: Ctx, *, events_since: datetime | None = None) -> Loaded:
    """The user's whole task state as the prototype's store holds it.

    Soft-deleted tasks are included (status ``deleted``, as on device);
    tasks removed by capture undo are not. Only ``rescheduled`` events feed
    the statistics, so only those are loaded.
    """
    list_rows = lists(ctx)
    task_rows = list(
        ctx.session.exec(
            select(Task)
            .where(
                Task.owner_id == ctx.user_id,
                Task.tenant_id == ctx.tenant_id,
                or_(col(Task.deleted_at).is_(None), col(Task.status) == "deleted"),
            )
            .order_by(col(Task.created_at), col(Task.id))
        ).all()
    )
    ev_where: list[ColumnElement[bool]] = [col(TaskEvent.type) == "rescheduled"]
    if events_since is not None:
        ev_where.append(col(TaskEvent.at) >= events_since)
    events = owned_repo.list_rows(ctx, TaskEvent, *ev_where)
    settings = settings_or_default(ctx)
    state = TasksState(
        lists=[list_view(lst) for lst in list_rows],
        tasks=[task_view(t) for t in task_rows],
        events=[EventView(type=e.type, at=e.at) for e in events],
        count_groceries=settings.count_groceries,
    )
    return Loaded(state=state, rows={str(t.id): t for t in task_rows}, lists=list_rows)
