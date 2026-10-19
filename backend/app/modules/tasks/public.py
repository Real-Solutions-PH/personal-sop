"""Cross-module contract of the tasks module (implemented by tasks).

Capture and the companion create, tick and look up tasks through these. They
only flush: the calling use case commits.
"""

import uuid
from dataclasses import dataclass
from datetime import date
from typing import Literal

from app.modules.tasks import ops, repo
from app.modules.tasks.models import Task
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
