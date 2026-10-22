"""Sync registrations for the tasks module (entities + domain actions).

Field writes go through ``ops`` so a synced edit obeys the same rules as a
REST one: a later ``due_date`` counts as a reschedule, a create appends its
``created`` event, a list delete moves its tasks to the Inbox. Status
changes are never field writes: ``tasks.complete`` / ``tasks.uncomplete``
are actions, so a recurring completion always spawns (or removes) its next
occurrence.

Restoring a soft-deleted task works both ways: the generic restore op
(``{"deleted_at": null}``) runs the task's ``restore`` hook, and the
``tasks.restore`` action stays for clients that already send it. Both leave
the ``deleted`` status as well as the tombstone.
"""

import uuid
from typing import Any

from pydantic import BaseModel

from app.modules.sync.registry import Action, Entity, Registry
from app.modules.tasks import ops, repo
from app.modules.tasks.models import Task, TaskList, TaskNotifState, TaskSettings
from app.modules.tasks.schema import (
    ClearCheckedArgs,
    CompleteArgs,
    DeleteListArgs,
    ListPublic,
    ListSync,
    NoArgs,
    NotifPublic,
    NotifUpdate,
    RescheduleArgs,
    SettingsPublic,
    SettingsUpdate,
    SnoozeArgs,
    TaskIdArgs,
    TaskIdsArgs,
    TaskPublic,
    TaskSync,
)
from app.shared import owned_repo
from app.shared.context import Ctx
from app.shared.owned import OwnedRow


def _dump(ctx: Ctx, row: OwnedRow | None, schema: type[BaseModel]) -> Any:
    if row is None:
        return None
    ctx.session.flush()
    ctx.session.refresh(row)
    return schema.model_validate(row).model_dump(mode="json")


# ---------------------------------------------------------------- entities


def upsert_task(ctx: Ctx, task_id: uuid.UUID, payload: BaseModel) -> OwnedRow:
    data = payload.model_dump(exclude_unset=True)
    t = owned_repo.get(ctx, Task, task_id, include_deleted=True)
    if t is None:
        t = ops.create_tasks(
            ctx,
            [
                ops.NewTask(
                    title=data["title"],
                    list_id=data.get("list_id"),
                    due_date=data.get("due_date"),
                    due_time=data.get("due_time"),
                    remind_at=data.get("remind_at"),
                    recurrence=data.get("recurrence"),
                    notes=data.get("notes"),
                    starred=bool(data.get("starred", False)),
                    tags=list(data.get("tags") or []),
                    source=data.get("source") or "manual",
                    parse_state=data.get("parse_state") or "parsed",
                    task_id=task_id,
                )
            ],
        )[0]
        extra = {k: data[k] for k in ("cleared_at", "sort_order") if k in data}
        if extra:
            ops.update(ctx, t, extra)
    else:
        if "due_date" in data:
            ops.set_due(
                ctx,
                t,
                data.pop("due_date"),
                data.pop("due_time", ops.UNSET),
                data.pop("remind_at", ops.UNSET),
            )
        if data:
            ops.update(ctx, t, data)
    ctx.commit()
    return t


def delete_task(ctx: Ctx, task_id: uuid.UUID) -> None:
    ops.soft_delete(ctx, repo.live_task(ctx, task_id))
    ctx.commit()


def upsert_list(ctx: Ctx, list_id: uuid.UUID, payload: BaseModel) -> OwnedRow:
    data = payload.model_dump(exclude_unset=True)
    lst = owned_repo.get(ctx, TaskList, list_id, include_deleted=True)
    if lst is None:
        base = {k: data.pop(k) for k in ("name", "kind", "color", "icon") if k in data}
        lst = ops.create_list(ctx, base, list_id)
    if data:
        ops.update_list(ctx, lst, data)
    ctx.commit()
    return lst


def delete_list(ctx: Ctx, list_id: uuid.UUID) -> None:
    ops.delete_list(ctx, repo.live_list(ctx, list_id), "inbox")
    ctx.commit()


def upsert_settings(ctx: Ctx, row_id: uuid.UUID, payload: BaseModel) -> OwnedRow:
    # One row per user: whatever id the device minted, the op lands on it.
    del row_id
    row = ops.update_settings(ctx, payload.model_dump(exclude_unset=True))
    ctx.commit()
    return row


def reset_settings(ctx: Ctx, row_id: uuid.UUID) -> None:
    del row_id
    ops.update_settings(ctx, dict(repo.SETTINGS_DEFAULTS))
    ctx.commit()


def upsert_notif(ctx: Ctx, row_id: uuid.UUID, payload: BaseModel) -> OwnedRow:
    del row_id
    row = ops.update_notif(ctx, payload.model_dump(exclude_unset=True))
    ctx.commit()
    return row


def reset_notif(ctx: Ctx, row_id: uuid.UUID) -> None:
    del row_id
    ops.update_notif(ctx, dict(repo.NOTIF_DEFAULTS))
    ctx.commit()


# ---------------------------------------------------------------- actions


def _complete(ctx: Ctx, args: dict[str, Any]) -> dict[str, Any]:
    t, nxt = ops.complete(
        ctx, repo.live_task(ctx, args["task_id"]), args.get("completed_at")
    )
    ctx.commit()
    return {"task": _dump(ctx, t, TaskPublic), "next": _dump(ctx, nxt, TaskPublic)}


def _uncomplete(ctx: Ctx, args: dict[str, Any]) -> dict[str, Any]:
    t = ops.uncomplete(ctx, repo.live_task(ctx, args["task_id"]))
    ctx.commit()
    return {"task": _dump(ctx, t, TaskPublic)}


def _reschedule_by(ctx: Ctx, args: dict[str, Any]) -> dict[str, Any]:
    t = ops.reschedule_by(ctx, repo.live_task(ctx, args["task_id"]), args["days"])
    ctx.commit()
    return {"task": _dump(ctx, t, TaskPublic)}


def _move_overdue(ctx: Ctx, args: dict[str, Any]) -> dict[str, Any]:
    del args
    n = ops.move_overdue_to_today(ctx)
    ctx.commit()
    return {"count": n}


def _snooze(ctx: Ctx, args: dict[str, Any]) -> dict[str, Any]:
    t = ops.snooze(ctx, repo.live_task(ctx, args["task_id"]), args["minutes"])
    ctx.commit()
    return {"task": _dump(ctx, t, TaskPublic)}


def _clear_checked(ctx: Ctx, args: dict[str, Any]) -> dict[str, Any]:
    ids = ops.clear_checked(ctx, args["list_id"])
    ctx.commit()
    return {"ids": [str(i) for i in ids]}


def _unclear(ctx: Ctx, args: dict[str, Any]) -> dict[str, Any]:
    ids = ops.unclear(ctx, args["task_ids"])
    ctx.commit()
    return {"ids": [str(i) for i in ids]}


def _delete_list(ctx: Ctx, args: dict[str, Any]) -> dict[str, Any]:
    n = ops.delete_list(ctx, repo.live_list(ctx, args["list_id"]), args["mode"])
    ctx.commit()
    return {"count": n}


def _restore_hook(ctx: Ctx, task_id: uuid.UUID) -> Task:
    """Engine restore hook: flushes only; the engine commits the op. A task
    removed by capture undo is not restorable (404), as over REST."""
    return ops.restore(ctx, repo.soft_deleted_task(ctx, task_id))


def _restore(ctx: Ctx, args: dict[str, Any]) -> dict[str, Any]:
    t = ops.restore(ctx, repo.soft_deleted_task(ctx, args["task_id"]))
    ctx.commit()
    return {"task": _dump(ctx, t, TaskPublic)}


def _remove(ctx: Ctx, args: dict[str, Any]) -> dict[str, Any]:
    ops.remove_tasks(ctx, args["task_ids"])
    ctx.commit()
    return {"ids": [str(i) for i in args["task_ids"]]}


ACTIONS: tuple[Action, ...] = (
    Action(name="tasks.complete", handler=_complete, args=CompleteArgs),
    Action(name="tasks.uncomplete", handler=_uncomplete, args=TaskIdArgs),
    Action(name="tasks.reschedule_by", handler=_reschedule_by, args=RescheduleArgs),
    Action(name="tasks.move_overdue_to_today", handler=_move_overdue, args=NoArgs),
    Action(name="tasks.snooze", handler=_snooze, args=SnoozeArgs),
    Action(name="tasks.clear_checked", handler=_clear_checked, args=ClearCheckedArgs),
    Action(name="tasks.unclear", handler=_unclear, args=TaskIdsArgs),
    Action(name="tasks.delete_list", handler=_delete_list, args=DeleteListArgs),
    Action(name="tasks.restore", handler=_restore, args=TaskIdArgs),
    Action(name="tasks.remove", handler=_remove, args=TaskIdsArgs),
)


def register(r: Registry) -> None:
    r.entity(
        Entity(
            name="task_list",
            model=TaskList,
            payload=ListSync,
            public=ListPublic,
            upsert=upsert_list,
            delete=delete_list,
            create_required=("name",),
        )
    )
    r.entity(
        Entity(
            name="task",
            model=Task,
            payload=TaskSync,
            public=TaskPublic,
            upsert=upsert_task,
            delete=delete_task,
            restore=_restore_hook,
            create_required=("title",),
        )
    )
    r.entity(
        Entity(
            name="task_settings",
            model=TaskSettings,
            payload=SettingsUpdate,
            public=SettingsPublic,
            upsert=upsert_settings,
            delete=reset_settings,
        )
    )
    r.entity(
        Entity(
            name="task_notif_state",
            model=TaskNotifState,
            payload=NotifUpdate,
            public=NotifPublic,
            upsert=upsert_notif,
            delete=reset_notif,
        )
    )
    for action in ACTIONS:
        r.action(action)
