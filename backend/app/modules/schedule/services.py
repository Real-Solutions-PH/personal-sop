"""Schedule overrides: writes (through sync) and the reads the calendar uses."""

import uuid
from datetime import date
from typing import Any

from sqlmodel import col

from app.modules.schedule import logic as L
from app.modules.schedule.models import ScheduleOverride
from app.shared import owned_repo
from app.shared.context import Ctx
from app.shared.domain import invalid
from app.shared.owned import OwnedRow


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
