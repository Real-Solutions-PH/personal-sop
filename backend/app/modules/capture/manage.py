"""Changing or removing something the person already has, from chat.

Two card kinds cover every module: ``edit`` (payload ``entity``, ``ids``,
``changes``) and ``remove`` (``entity``, ``ids``). Each goes through the
owning module's ``public.py`` and the same rules as its screen. An edit
keeps every row's earlier values in ``prior`` so Undo puts them back; a
removal deletes what has a restore (a transaction, a task, a meal, a
weigh-in) and archives the rest (a scheduled payment, an account, a budget,
a habit, a routine), which keeps their history and undoes cleanly.
"""

import uuid
from typing import Any

from app.modules.capture import ports
from app.shared.context import Ctx
from app.shared.domain import invalid

FINANCE = ("record", "planned", "account", "budget")
ENTITIES = (*FINANCE, "task", "habit", "routine", "meal", "weighIn")
# What a removal does: archive (reversible, history kept) or delete.
ARCHIVED = ("planned", "account", "budget", "habit", "routine")


def _ids(p: dict[str, Any]) -> list[uuid.UUID]:
    try:
        return [uuid.UUID(str(i)) for i in p.get("ids") or []]
    except ValueError:
        raise invalid("ids_invalid", "That card points at something unknown") from None


def _entity(p: dict[str, Any]) -> str:
    e = str(p.get("entity"))
    if e not in ENTITIES:
        raise invalid("entity_unknown", "That card points at something unknown")
    return e


def _edit_one(
    ctx: Ctx, entity: str, row_id: uuid.UUID, changes: dict[str, Any]
) -> dict[str, Any]:
    """Apply ``changes`` and return the earlier values."""
    if entity in FINANCE:
        return ports.finance.edit_row(
            ctx,
            entity=entity,  # type: ignore[arg-type]
            row_id=row_id,
            changes=changes,
        )
    if entity == "task":
        before = ports.tasks.task_state(ctx, task_id=row_id)
        ports.tasks.edit_task(ctx, task_id=row_id, changes=changes)
        return {k: before[k] for k in changes if k in before}
    raise invalid("not_editable", "That can't be changed from chat")


def apply(ctx: Ctx, p: dict[str, Any]) -> tuple[list[str], dict[str, Any]]:
    """Save an ``edit`` or ``remove`` card: the ids it touched and what Undo
    needs."""
    entity = _entity(p)
    ids = _ids(p)
    if not ids:
        raise invalid("nothing_to_change", "Nothing to change")
    if p["kind"] == "edit":
        changes = dict(p.get("changes") or {})
        if not changes:
            raise invalid("nothing_to_change", "Nothing to change")
        before = {str(i): _edit_one(ctx, entity, i, changes) for i in ids}
        return [str(i) for i in ids], {"before": before}
    for i in ids:
        if entity == "record":
            ports.finance.delete_records(ctx, record_ids=[i])
        elif entity in ("planned", "account", "budget"):
            ports.finance.edit_row(
                ctx,
                entity=entity,  # type: ignore[arg-type]
                row_id=i,
                changes={"archived": True},
            )
        elif entity == "task":
            ports.tasks.delete_task(ctx, task_id=i)
        elif entity == "habit":
            ports.habits.set_habit_archived(ctx, habit_id=i, archived=True)
        elif entity == "routine":
            ports.habits.set_routine_archived(ctx, routine_id=i, archived=True)
        elif entity == "meal":
            ports.fitness.delete_meal(ctx, meal_id=i)
        elif entity == "weighIn":
            ports.fitness.delete_weigh_in(ctx, weigh_in_id=i)
    return [str(i) for i in ids], {
        "how": "archived" if entity in ARCHIVED else "deleted"
    }


def undo(ctx: Ctx, p: dict[str, Any], refs: list[str], prior: dict[str, Any]) -> None:
    """Put back what ``apply`` changed."""
    entity = _entity(p)
    ids = [uuid.UUID(r) for r in refs]
    if p["kind"] == "edit":
        before: dict[str, Any] = dict(prior.get("before") or {})
        for i in ids:
            values = before.get(str(i))
            if values:
                _edit_one(ctx, entity, i, dict(values))
        return
    for i in ids:
        if entity == "record":
            ports.finance.restore_records(ctx, record_ids=[i])
        elif entity in ("planned", "account", "budget"):
            ports.finance.edit_row(
                ctx,
                entity=entity,  # type: ignore[arg-type]
                row_id=i,
                changes={"archived": False},
            )
        elif entity == "task":
            ports.tasks.restore_task(ctx, task_id=i)
        elif entity == "habit":
            ports.habits.set_habit_archived(ctx, habit_id=i, archived=False)
        elif entity == "routine":
            ports.habits.set_routine_archived(ctx, routine_id=i, archived=False)
        elif entity == "meal":
            ports.fitness.restore_meal(ctx, meal_id=i)
        elif entity == "weighIn":
            ports.fitness.restore_weigh_in(ctx, weigh_in_id=i)
