"""The tasks module's mutations, ported from ``shared/prototype/tasks/actions.ts``.

Every function here only flushes: the REST use cases (``services``), the sync
handlers and the cross-module contract (``public``) wrap them and own the
commit. Every change that the prototype records appends a ``task_event`` row,
and every change to a business day marks the stats rollup dirty.
"""

import uuid
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from typing import Any, TypeVar

from sqlalchemy.exc import IntegrityError
from sqlmodel import col, delete

from app.modules.stats import public as stats
from app.modules.tasks import repo
from app.modules.tasks.logic import add_days, next_due
from app.modules.tasks.models import (
    Task,
    TaskEvent,
    TaskList,
    TaskNotifState,
    TaskSettings,
)
from app.modules.tasks.parse import split_capture, valid_day
from app.shared import owned_repo
from app.shared.context import Ctx
from app.shared.domain import conflict, invalid
from app.shared.ids import derived_id

UNSET: Any = object()

DEFAULT_LISTS = (
    ("work", "Work", "standard", "tsk", "briefcase"),
    ("life", "Life", "standard", "hab", "home"),
    ("groceries", "Groceries", "shopping", "fit", "cart"),
)


def dirty(ctx: Ctx, *days: date | None) -> None:
    for d in {d for d in days if d is not None}:
        stats.mark_dirty(ctx, module="tasks", day=d)


def event(
    ctx: Ctx,
    task_id: uuid.UUID,
    type_: str,
    *,
    from_due: date | None = None,
    to_due: date | None = None,
    at: datetime | None = None,
) -> None:
    ctx.session.add(
        TaskEvent(
            **ctx.owned(),
            task_id=task_id,
            type=type_,
            from_due=from_due,
            to_due=to_due,
            at=at or ctx.now,
        )
    )


M = TypeVar("M", Task, TaskList)


def insert_new(
    ctx: Ctx, model: type[M], data: dict[str, Any], row_id: uuid.UUID | None
) -> M:
    """Insert a row under a client-minted id. An id another user already
    holds is invisible here and trips the primary key: that is a 409, inside
    a savepoint so the rest of the request (or sync batch) survives."""
    try:
        with ctx.session.begin_nested():
            return owned_repo.insert(ctx, model, data, row_id=row_id)
    except IntegrityError:
        raise conflict("id_conflict", "This id is already in use") from None


def _check_list(ctx: Ctx, list_id: uuid.UUID | None) -> None:
    if list_id is not None:
        repo.live_list(ctx, list_id)


# ---------------------------------------------------------------- create


@dataclass(frozen=True)
class NewTask:
    title: str
    list_id: uuid.UUID | None = None
    due_date: date | None = None
    due_time: str | None = None
    remind: bool = False
    remind_at: datetime | None = None
    recurrence: dict[str, Any] | None = None
    notes: str | None = None
    starred: bool = False
    source: str = "manual"
    parse_state: str = "parsed"
    task_id: uuid.UUID | None = None


def _build(ctx: Ctx, n: NewTask, order: int, remind_time: str) -> dict[str, Any]:
    remind_at = n.remind_at
    if remind_at is None and n.remind and n.due_date is not None:
        remind_at = ctx.clock.local_time(n.due_date, n.due_time or remind_time)
    return {
        "title": n.title.strip() or "Untitled",
        "list_id": n.list_id,
        "due_date": n.due_date,
        "due_time": n.due_time,
        "remind_at": remind_at,
        "recurrence": n.recurrence,
        "notes": n.notes,
        "starred": n.starred,
        "status": "open",
        "completed_at": None,
        "cleared_at": None,
        "source": n.source,
        "parse_state": n.parse_state,
        "original_due": n.due_date,
        "reschedule_count": 0,
        "sort_order": order,
    }


def create_tasks(ctx: Ctx, items: list[NewTask]) -> list[Task]:
    """Create one row per item. A client id that already exists for this
    user returns that row unchanged (a replayed create is a no-op)."""
    settings = repo.settings_or_default(ctx)
    order = repo.next_order(ctx)
    out: list[Task] = []
    for n in items:
        if n.task_id is not None:
            existing = owned_repo.get(ctx, Task, n.task_id, include_deleted=True)
            if existing is not None:
                out.append(existing)
                continue
        _check_list(ctx, n.list_id)
        row = insert_new(
            ctx, Task, _build(ctx, n, order, settings.default_remind_time), n.task_id
        )
        order += 1
        event(ctx, row.id, "created")
        dirty(ctx, row.due_date, ctx.today)
        out.append(row)
    ctx.session.flush()
    return out


def _list_keys(ctx: Ctx) -> dict[str, uuid.UUID]:
    """Map the capture router's keys onto this user's non-archived lists:
    by name (Work, Job 2, Life, Groceries), groceries also by the first
    shopping list."""
    keys: dict[str, uuid.UUID] = {}
    for lst in repo.lists(ctx, include_archived=False):
        name = " ".join(lst.name.lower().split())
        key = {
            "work": "work",
            "job 2": "job2",
            "job2": "job2",
            "life": "life",
            "groceries": "groceries",
        }.get(name)
        if key and key not in keys:
            keys[key] = lst.id
    if "groceries" not in keys:
        for lst in repo.lists(ctx, include_archived=False):
            if lst.kind == "shopping":
                keys["groceries"] = lst.id
                break
    return keys


def capture(ctx: Ctx, text: str, source: str) -> tuple[list[Task], uuid.UUID | None]:
    keys = _list_keys(ctx)
    drafts = split_capture(text, ctx.today.isoformat(), source, list(keys))
    items = []
    for d in drafts:
        due = valid_day(d.due_date)
        items.append(
            NewTask(
                title=d.title,
                list_id=keys.get(d.list_key) if d.list_key else None,
                due_date=due,
                due_time=d.due_time,
                recurrence=d.recurrence,
                remind=due is not None and not d.vague and d.list_key != "groceries",
                source=source,
            )
        )
    tasks = create_tasks(ctx, items)
    follow = next((tasks[i].id for i, d in enumerate(drafts) if d.vague), None)
    return tasks, follow


def remove_tasks(ctx: Ctx, ids: Iterable[uuid.UUID]) -> None:
    """Capture undo: the tasks never happened. Tombstoned (so other devices
    drop them) with their status kept, which keeps them out of Recently
    deleted and the statistics; their history is erased."""
    rows = repo.tasks_by_ids(ctx, list(ids))
    for t in rows:
        owned_repo.soft_delete(ctx, t)
        dirty(ctx, t.due_date, ctx.clock.day_of(t.created_at))
    if rows:
        ctx.session.execute(
            delete(TaskEvent).where(
                col(TaskEvent.owner_id) == ctx.user_id,
                col(TaskEvent.task_id).in_([t.id for t in rows]),
            )
        )
    ctx.session.flush()


# ---------------------------------------------------------------- complete


def next_occurrence_id(task_id: uuid.UUID, due: date) -> uuid.UUID:
    return derived_id("task-next", task_id, due.isoformat())


def _spawned_next(ctx: Ctx, t: Task) -> Task | None:
    for child in repo.children(ctx, t.id):
        if child.original_due and child.id == next_occurrence_id(
            t.id, child.original_due
        ):
            return child
    return None


def complete(
    ctx: Ctx, t: Task, completed_at: datetime | None = None
) -> tuple[Task, Task | None]:
    """Complete ``t``; a recurring task also gets its next occurrence.

    Idempotent: completing a task that is already done changes nothing and
    returns the occurrence the first completion spawned.
    """
    if t.status != "open":
        return t, _spawned_next(ctx, t)
    at = min(completed_at or ctx.now, ctx.now)
    day = ctx.clock.day_of(at)
    nxt: Task | None = None
    if t.recurrence:
        due = next_due(t.recurrence, t.due_date or day, day)
        shift = (due - t.due_date).days if t.due_date else 0
        settings = repo.settings_or_default(ctx)
        data = _build(
            ctx,
            NewTask(
                title=t.title,
                list_id=t.list_id,
                due_date=due,
                due_time=t.due_time,
                recurrence=t.recurrence,
                notes=t.notes,
                starred=t.starred,
                source=t.source,
            ),
            t.sort_order,
            settings.default_remind_time,
        )
        data["remind_at"] = t.remind_at + timedelta(days=shift) if t.remind_at else None
        data["series_parent_id"] = t.id
        nid = next_occurrence_id(t.id, due)
        existing = owned_repo.get(ctx, Task, nid, include_deleted=True)
        if existing is None:
            nxt = owned_repo.insert(ctx, Task, data, row_id=nid)
            event(ctx, nid, "created")
        elif existing.deleted_at is not None:
            # Spawned before, removed by an uncomplete: revive it.
            nxt = owned_repo.apply(existing, data)
            nxt.deleted_at = None
            ctx.session.add(nxt)
            event(ctx, nid, "created")
        else:
            # The device already created it optimistically: adopt it.
            nxt = existing
            if nxt.series_parent_id is None:
                nxt.series_parent_id = t.id
                ctx.session.add(nxt)
        dirty(ctx, due)
    t.status = "done"
    t.completed_at = at
    ctx.session.add(t)
    event(ctx, t.id, "completed", at=at)
    dirty(ctx, day, t.due_date)
    ctx.session.flush()
    return t, nxt


def _untouched(ctx: Ctx, child: Task, parent: Task) -> bool:
    """The spawned occurrence is exactly as completion made it."""
    return (
        child.status == "open"
        and child.original_due is not None
        and child.id == next_occurrence_id(parent.id, child.original_due)
        and child.due_date == child.original_due
        and child.reschedule_count == 0
        and child.title == parent.title
        and child.list_id == parent.list_id
        and child.notes == parent.notes
        and child.starred == parent.starred
        and child.due_time == parent.due_time
        and child.recurrence == parent.recurrence
        and repo.event_types(ctx, child.id) == ["created"]
    )


def uncomplete(ctx: Ctx, t: Task) -> Task:
    """Reopen ``t``. The occurrence its completion spawned is removed when it
    is still untouched; once edited, rescheduled or ticked it stays."""
    if t.status != "done":
        return t
    day = ctx.clock.day_of(t.completed_at) if t.completed_at else ctx.today
    child = _spawned_next(ctx, t)
    if child is not None and _untouched(ctx, child, t):
        remove_tasks(ctx, [child.id])
    t.status = "open"
    t.completed_at = None
    t.cleared_at = None
    ctx.session.add(t)
    event(ctx, t.id, "uncompleted")
    dirty(ctx, day, t.due_date)
    ctx.session.flush()
    return t


# ---------------------------------------------------------------- edit


def update(ctx: Ctx, t: Task, patch: dict[str, Any]) -> Task:
    if "list_id" in patch:
        _check_list(ctx, patch["list_id"])
    if "title" in patch and patch["title"] is not None:
        patch["title"] = patch["title"].strip() or "Untitled"
    for key in ("title", "starred"):
        if key in patch and patch[key] is None:
            raise invalid("field_required", "This field cannot be cleared")
    owned_repo.apply(t, patch)
    ctx.session.add(t)
    dirty(ctx, t.due_date)
    ctx.session.flush()
    return t


def set_due(
    ctx: Ctx,
    t: Task,
    due_date: date | None,
    due_time: str | None = UNSET,
    remind_at: datetime | None = UNSET,
) -> Task:
    """Moving a due date LATER is a reschedule: it counts, it is logged, and
    ``original_due`` keeps the first date so lateness cannot be hidden."""
    old = t.due_date
    later = old is not None and due_date is not None and due_date > old
    t.due_date = due_date
    if due_time is not UNSET:
        t.due_time = due_time
    if remind_at is not UNSET:
        t.remind_at = remind_at
    t.original_due = t.original_due or due_date
    if later:
        t.reschedule_count += 1
        event(ctx, t.id, "rescheduled", from_due=old, to_due=due_date)
    ctx.session.add(t)
    dirty(ctx, old, due_date)
    ctx.session.flush()
    return t


def reschedule_by(ctx: Ctx, t: Task, days: int) -> Task:
    return set_due(ctx, t, add_days(ctx.today, days))


def move_overdue_to_today(ctx: Ctx) -> int:
    rows = repo.overdue_open(ctx, ctx.today)
    for t in rows:
        set_due(ctx, t, ctx.today)
    return len(rows)


def snooze(ctx: Ctx, t: Task, minutes: int) -> Task:
    """Push the reminder (not the due date: a snooze is not a reschedule)."""
    base = max(ctx.now, t.remind_at) if t.remind_at else ctx.now
    t.remind_at = base + timedelta(minutes=minutes)
    ctx.session.add(t)
    event(ctx, t.id, "snoozed")
    ctx.session.flush()
    return t


# ---------------------------------------------------------------- delete


def soft_delete(ctx: Ctx, t: Task) -> Task:
    t.status = "deleted"
    t.deleted_at = ctx.now
    ctx.session.add(t)
    event(ctx, t.id, "deleted")
    dirty(ctx, t.due_date)
    ctx.session.flush()
    return t


def restore(ctx: Ctx, t: Task) -> Task:
    if t.status != "deleted":
        return t
    if t.list_id is not None and owned_repo.get(ctx, TaskList, t.list_id) is None:
        t.list_id = None
    t.status = "done" if t.completed_at else "open"
    t.deleted_at = None
    ctx.session.add(t)
    event(ctx, t.id, "restored")
    dirty(ctx, t.due_date)
    ctx.session.flush()
    return t


def duplicate(ctx: Ctx, t: Task, new_id: uuid.UUID | None = None) -> Task:
    keep_due = t.due_date if t.due_date and t.due_date >= ctx.today else None
    return create_tasks(
        ctx,
        [
            NewTask(
                title=t.title,
                list_id=t.list_id,
                due_date=keep_due,
                due_time=t.due_time,
                recurrence=t.recurrence,
                notes=t.notes,
                starred=t.starred,
                task_id=new_id,
            )
        ],
    )[0]


def move(ctx: Ctx, task_id: uuid.UUID, step: int, ids: list[uuid.UUID]) -> None:
    """Swap ``task_id`` with its neighbour in the visible order ``ids`` and
    renumber those rows (``moveTask``)."""
    if len(set(ids)) != len(ids):
        raise invalid("duplicate_ids", "Each task may appear once")
    rows = {t.id: t for t in repo.tasks_by_ids(ctx, ids)}
    if len(rows) != len(ids):
        repo.live_task(ctx, next(i for i in ids if i not in rows))
    if task_id not in rows:
        repo.live_task(ctx, task_id)
        raise invalid("task_not_in_order", "The task is not in this order")
    i = ids.index(task_id)
    j = i + step
    if j < 0 or j >= len(ids):
        return
    order = list(ids)
    order[i], order[j] = order[j], order[i]
    for rank, rid in enumerate(order):
        rows[rid].sort_order = rank
        ctx.session.add(rows[rid])
    ctx.session.flush()


# ---------------------------------------------------------------- shopping


def clear_checked(ctx: Ctx, list_id: uuid.UUID) -> list[uuid.UUID]:
    repo.live_list(ctx, list_id)
    rows = owned_repo.list_rows(
        ctx,
        Task,
        col(Task.list_id) == list_id,
        col(Task.status) == "done",
        col(Task.cleared_at).is_(None),
    )
    for t in rows:
        t.cleared_at = ctx.now
        ctx.session.add(t)
    ctx.session.flush()
    return [t.id for t in rows]


def unclear(ctx: Ctx, ids: list[uuid.UUID]) -> list[uuid.UUID]:
    rows = repo.tasks_by_ids(ctx, ids)
    for t in rows:
        t.cleared_at = None
        ctx.session.add(t)
    ctx.session.flush()
    return [t.id for t in rows]


# ---------------------------------------------------------------- lists


def create_list(ctx: Ctx, data: dict[str, Any], list_id: uuid.UUID | None) -> TaskList:
    if list_id is not None:
        existing = owned_repo.get(ctx, TaskList, list_id, include_deleted=True)
        if existing is not None:
            return existing
    data = {
        **data,
        "sort_order": len(repo.lists(ctx)),
        "archived_at": None,
        "is_default": False,
    }
    return insert_new(ctx, TaskList, data, list_id)


def ensure_default_lists(ctx: Ctx) -> list[TaskList]:
    """Seed Work, Life and Groceries once (the IA's defaults), with derived
    ids the device can mint too. A user who ever had a list is left alone,
    so deleting a default never brings it back."""
    if repo.any_list_ever(ctx):
        return repo.lists(ctx)
    for i, (key, name, kind, color, icon) in enumerate(DEFAULT_LISTS):
        owned_repo.insert(
            ctx,
            TaskList,
            {
                "name": name,
                "kind": kind,
                "color": color,
                "icon": icon,
                "sort_order": i,
                "is_default": True,
            },
            row_id=derived_id("task-list-default", ctx.user_id, key),
        )
    return repo.lists(ctx)


def update_list(ctx: Ctx, lst: TaskList, patch: dict[str, Any]) -> TaskList:
    for key in ("name", "kind", "color", "icon"):
        if key in patch and patch[key] is None:
            raise invalid("field_required", "This field cannot be cleared")
    owned_repo.apply(lst, patch)
    ctx.session.add(lst)
    ctx.session.flush()
    return lst


def set_list_archived(ctx: Ctx, lst: TaskList, archived: bool) -> TaskList:
    if archived and lst.archived_at is None:
        lst.archived_at = ctx.now
    elif not archived:
        lst.archived_at = None
    ctx.session.add(lst)
    ctx.session.flush()
    return lst


def delete_list(ctx: Ctx, lst: TaskList, mode: str) -> int:
    """Delete a list; its tasks move to the Inbox, or (mode ``delete``) its
    open tasks are deleted. Returns how many tasks were touched."""
    if mode not in ("inbox", "delete"):
        raise invalid("bad_mode", "Choose inbox or delete")
    rows = owned_repo.list_rows(
        ctx, Task, col(Task.list_id) == lst.id, include_deleted=True
    )
    for t in rows:
        if mode == "delete" and t.status == "open" and t.deleted_at is None:
            t.status = "deleted"
            t.deleted_at = ctx.now
            event(ctx, t.id, "deleted")
            dirty(ctx, t.due_date)
        t.list_id = None
        ctx.session.add(t)
    owned_repo.soft_delete(ctx, lst)
    ctx.session.flush()
    return len(rows)


def move_list(ctx: Ctx, lst: TaskList, step: int) -> list[TaskList]:
    ordered = repo.lists(ctx)
    i = next(k for k, x in enumerate(ordered) if x.id == lst.id)
    j = i + step
    if j < 0 or j >= len(ordered):
        return ordered
    ordered[i], ordered[j] = ordered[j], ordered[i]
    for k, x in enumerate(ordered):
        x.sort_order = k
        ctx.session.add(x)
    ctx.session.flush()
    return ordered


# ---------------------------------------------------------------- settings


def update_settings(ctx: Ctx, patch: dict[str, Any]) -> TaskSettings:
    for key, value in patch.items():
        if value is None:
            raise invalid(
                "field_required", "This field cannot be cleared", {"field": key}
            )
    row = repo.settings_row(ctx)
    if row is None:
        row = owned_repo.insert(
            ctx,
            TaskSettings,
            {**repo.SETTINGS_DEFAULTS, **patch},
            row_id=repo.settings_id(ctx),
        )
    else:
        owned_repo.apply(row, patch)
        row.deleted_at = None
        ctx.session.add(row)
    ctx.session.flush()
    return row


def update_notif(ctx: Ctx, patch: dict[str, Any]) -> TaskNotifState:
    for key in ("platform", "installed", "permission"):
        if key in patch and patch[key] is None:
            raise invalid(
                "field_required", "This field cannot be cleared", {"field": key}
            )
    row = owned_repo.find_one(ctx, TaskNotifState, include_deleted=True)
    if row is None:
        row = owned_repo.insert(
            ctx,
            TaskNotifState,
            {**repo.NOTIF_DEFAULTS, **patch},
            row_id=repo.notif_id(ctx),
        )
    else:
        owned_repo.apply(row, patch)
        row.deleted_at = None
        ctx.session.add(row)
    ctx.session.flush()
    return row


def require_open_or_done(t: Task) -> Task:
    if t.status == "deleted":
        raise conflict("task_deleted", "This task is deleted")
    return t
