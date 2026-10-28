"""Cross-module contract of the tasks module (implemented by tasks).

Capture and the companion create, tick and look up tasks through these. They
only flush: the calling use case commits.
"""

import uuid
from dataclasses import dataclass, field
from datetime import date
from typing import Any, Literal

from sqlmodel import col

from app.modules.tasks import ops, repo
from app.modules.tasks.models import Task, TaskList
from app.shared import owned_repo
from app.shared.context import Ctx

TaskSource = Literal["manual", "capture-text", "capture-voice", "capture-photo"]


@dataclass(frozen=True)
class TaskDraft:
    title: str
    list_id: uuid.UUID | None = None
    due_date: date | None = None
    due_time: str | None = None
    remind: bool = False
    task_id: uuid.UUID | None = None
    tags: list[str] = field(default_factory=list)


def create_tasks(
    ctx: Ctx, drafts: list[TaskDraft], *, source: TaskSource = "manual"
) -> list[Task]:
    """Create tasks; a draft whose ``task_id`` already exists returns that row
    (replay-safe). A ``remind`` draft with a date gets the user's default
    reminder time when it has no time of its own."""
    return ops.create_tasks(
        ctx,
        [
            ops.NewTask(
                title=d.title,
                list_id=d.list_id,
                due_date=d.due_date,
                due_time=d.due_time,
                remind=d.remind,
                source=source,
                task_id=d.task_id,
                tags=list(d.tags),
            )
            for d in drafts
        ],
    )


def complete_task(ctx: Ctx, *, task_id: uuid.UUID) -> Task:
    """Completes; for a recurring task also creates the next occurrence with
    id ``derived_id("task-next", task_id, <next due iso>)``. Completing a
    task that is already done is a no-op."""
    t, _ = ops.complete(ctx, repo.live_task(ctx, task_id))
    return t


def uncomplete_task(ctx: Ctx, *, task_id: uuid.UUID) -> Task:
    """Reopens; removes the spawned next occurrence if it is untouched."""
    return ops.uncomplete(ctx, repo.live_task(ctx, task_id))


def remove_tasks(ctx: Ctx, *, task_ids: list[uuid.UUID]) -> None:
    """Undo a capture: the tasks and their history disappear (tombstoned for
    sync, excluded from statistics and Recently deleted)."""
    ops.remove_tasks(ctx, task_ids)


def find_open_tasks(ctx: Ctx, query: str, *, limit: int = 5) -> list[Task]:
    """Open tasks whose title or notes contain ``query`` (case-insensitive),
    in due order: the companion's "done with call Mark" lookup."""
    if not query.strip():
        return []
    return repo.find_open(ctx, query, limit=max(1, min(limit, 50)))


def reschedule_by(ctx: Ctx, *, task_id: uuid.UUID, days: int) -> Task:
    """Move a task's due date by ``days`` (counted as a reschedule). Flushes
    only; the calling use case commits."""
    return ops.reschedule_by(ctx, repo.live_task(ctx, task_id), days)


def list_open_tasks(
    ctx: Ctx, *, order: Literal["newest", "due"], limit: int
) -> list[Task]:
    """Open tasks, at most ``limit``: newest first, or by due date (undated
    last) then creation."""
    order_by: list[Any] = (
        [col(Task.created_at).desc()]
        if order == "newest"
        else [col(Task.due_date), col(Task.created_at)]
    )
    return owned_repo.list_rows(
        ctx, Task, col(Task.status) == "open", order_by=order_by, limit=limit
    )


def count_open_due_by(ctx: Ctx, *, day: date) -> int:
    """Open tasks with a due date on or before ``day`` (overdue included)."""
    return owned_repo.count_rows(
        ctx,
        Task,
        col(Task.status) == "open",
        col(Task.due_date).is_not(None),
        col(Task.due_date) <= day,
    )


def list_keys(ctx: Ctx) -> dict[str, uuid.UUID]:
    """The capture router's list keys (``work``, ``job2``, ``life``,
    ``groceries``) mapped onto this user's non-archived lists."""
    return ops._list_keys(ctx)


def create_list(
    ctx: Ctx,
    *,
    name: str,
    kind: Literal["standard", "shopping"] = "standard",
    list_id: uuid.UUID | None = None,
) -> TaskList:
    """A new task list after the existing ones."""
    return ops.create_list(ctx, {"name": name, "kind": kind}, list_id)


def delete_list(ctx: Ctx, *, list_id: uuid.UUID) -> None:
    """Delete a list; any tasks still in it move to the Inbox."""
    ops.delete_list(ctx, repo.live_list(ctx, list_id), "inbox")


def find_list(ctx: Ctx, name: str) -> TaskList | None:
    """A live list with this name (case-insensitive)."""
    n = name.strip().lower()
    return next((x for x in repo.lists(ctx) if x.name.lower() == n), None)


# ------------------------------------------------- edits from chat (Fern)


def task_state(ctx: Ctx, *, task_id: uuid.UUID) -> dict[str, Any]:
    """What ``edit_task`` can change, as it is now (to put it back)."""
    t = repo.live_task(ctx, task_id)
    return {
        "title": t.title,
        "notes": t.notes,
        "list_id": str(t.list_id) if t.list_id else None,
        "due_date": t.due_date.isoformat() if t.due_date else None,
        "due_time": t.due_time,
        "tags": list(t.tags or []),
    }


def edit_task(ctx: Ctx, *, task_id: uuid.UUID, changes: dict[str, Any]) -> None:
    """Title, notes or list through the task screen's rules; a due date
    through ``set_due``, so moving it later counts as a reschedule."""
    t = repo.live_task(ctx, task_id)
    patch = {
        k: v for k, v in changes.items() if k in ("title", "notes", "list_id", "tags")
    }
    if "list_id" in patch and patch["list_id"] is not None:
        patch["list_id"] = uuid.UUID(str(patch["list_id"]))
    if patch:
        ops.update(ctx, t, patch)
    if "due_date" in changes:
        due = changes["due_date"]
        ops.set_due(
            ctx,
            t,
            date.fromisoformat(str(due)) if due else None,
            changes.get("due_time", ops.UNSET),
        )


def delete_task(ctx: Ctx, *, task_id: uuid.UUID) -> None:
    ops.soft_delete(ctx, repo.live_task(ctx, task_id))


def restore_task(ctx: Ctx, *, task_id: uuid.UUID) -> None:
    ops.restore(ctx, repo.soft_deleted_task(ctx, task_id))


def task_facts(ctx: Ctx, first: date, last: date) -> list[dict[str, Any]]:
    """One row per task finished, or due, in the days ``[first, last]``,
    on the day it was finished (else its due day)."""
    lo, hi = ctx.clock.window(first, last)
    lists = {t.id: t.name for t in owned_repo.list_rows(ctx, TaskList)}
    rows = owned_repo.list_rows(
        ctx,
        Task,
        (col(Task.completed_at) >= lo) & (col(Task.completed_at) < hi)
        | (col(Task.due_date) >= first) & (col(Task.due_date) <= last),
    )
    out = []
    for t in rows:
        done_on = ctx.clock.day_of(t.completed_at) if t.completed_at else None
        day = done_on if done_on and first <= done_on <= last else t.due_date
        if day is None:
            continue
        out.append(
            {
                "day": day.isoformat(),
                "task": t.title,
                "list": lists.get(t.list_id, "Inbox") if t.list_id else "Inbox",
                "status": t.status,
                "due": t.due_date.isoformat() if t.due_date else None,
                "done": 1 if t.status == "done" else 0,
                "open": 1 if t.status == "open" else 0,
            }
        )
    return sorted(out, key=lambda r: r["day"])
