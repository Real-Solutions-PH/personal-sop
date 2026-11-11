"""Schedule overrides: writes (through sync) and the reads the calendar uses."""

import uuid
from collections.abc import Sequence
from dataclasses import replace
from datetime import date, timedelta
from typing import TYPE_CHECKING, Any

from sqlmodel import col

from app.modules.schedule import logic as L
from app.modules.schedule.models import ScheduleOverride
from app.shared import owned_repo
from app.shared.context import Ctx
from app.shared.domain import invalid
from app.shared.owned import OwnedRow

if TYPE_CHECKING:
    from app.modules.tasks.logic import TaskView

# The furthest a move can shift a reminder: a whole business day.
MAX_SHIFT = timedelta(hours=24)


def _owner_model(kind: str) -> type[OwnedRow]:
    if kind == "habit":
        from app.modules.habits.models import Habit

        return Habit
    if kind == "routine":
        from app.modules.habits.models import Routine

        return Routine
    if kind == "task":
        from app.modules.tasks.models import Task

        return Task
    raise invalid("override_kind_invalid", "Only habits, routines and tasks move")


def upsert(ctx: Ctx, row_id: uuid.UUID, data: dict[str, Any]) -> ScheduleOverride:
    before = owned_repo.get(ctx, ScheduleOverride, row_id, include_deleted=True)
    kind = data.get("kind") or (before.kind if before else None)
    ref = data.get("ref_id") or (before.ref_id if before else None)
    if kind is None or ref is None:
        raise invalid("missing_fields", "A moved item needs its kind and id")
    # The item must be one of this user's own (owned_repo scopes by owner).
    owned_repo.require(ctx, _owner_model(kind), ref, what=kind)
    natural = (
        ("kind", "ref_id", "day") if {"kind", "ref_id", "day"} <= set(data) else ()
    )
    row, _ = owned_repo.upsert(ctx, ScheduleOverride, row_id, data, natural_key=natural)
    return row


def in_window(ctx: Ctx, first: date, last: date) -> list[L.Override]:
    rows = owned_repo.list_rows(
        ctx,
        ScheduleOverride,
        col(ScheduleOverride.day) >= first,
        col(ScheduleOverride.day) <= last,
    )
    return [
        L.Override(kind=r.kind, ref_id=r.ref_id, day=r.day, time=r.time)  # type: ignore[arg-type]
        for r in rows
    ]


def moved_task_reminders(ctx: Ctx, views: Sequence["TaskView"]) -> list["TaskView"]:
    """Tasks with a moved occurrence on their due day remind as much later or
    earlier, and read the moved time (the phone does the same for its local
    reminder: ``local-reminders.ts``)."""
    days = {v.due_date for v in views if v.due_date is not None}
    if not days:
        return list(views)
    moved = {
        (str(o.ref_id), o.day): o.time
        for o in in_window(ctx, min(days), max(days))
        if o.kind == "task"
    }
    out: list[TaskView] = []
    for v in views:
        to = moved.get((v.id, v.due_date)) if v.due_date else None
        if to is None:
            out.append(v)
            continue
        by = shift_by(v.due_time, to)
        remind = v.remind_at + by if v.remind_at else None
        out.append(replace(v, due_time=to, remind_at=remind))
    return out


def shift_by(own: str | None, moved: str) -> timedelta:
    return timedelta(minutes=L.shift_minutes(own, moved)) if own else timedelta(0)
