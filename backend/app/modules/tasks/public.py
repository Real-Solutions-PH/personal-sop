"""Cross-module contract of the tasks module (implemented by tasks)."""

import uuid
from dataclasses import dataclass
from datetime import date
from typing import Literal

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
    raise NotImplementedError


def complete_task(ctx: Ctx, *, task_id: uuid.UUID) -> Task:
    """Completes; for a recurring task also creates the next occurrence with
    id ``derived_id("task-next", task_id, <next due iso>)``."""
    raise NotImplementedError


def uncomplete_task(ctx: Ctx, *, task_id: uuid.UUID) -> Task:
    raise NotImplementedError


def remove_tasks(ctx: Ctx, *, task_ids: list[uuid.UUID]) -> None:
    raise NotImplementedError


def find_open_tasks(ctx: Ctx, query: str, *, limit: int = 5) -> list[Task]:
    raise NotImplementedError
