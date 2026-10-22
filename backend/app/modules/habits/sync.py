"""Sync registrations for the habits module (entities + domain actions).

Field writes (rename, schedule, archive via ``status``, reorder via
``sort_order``, a pause range) are entity upserts. Everything with a rule
beyond a field write is an action: logging by tap / count / skip, the habit
timer and the routine-run state machine. Runs, step results and the timer
are pulled but never pushed as rows: they move only through actions.
"""

import uuid
from collections.abc import Callable
from typing import Any

from pydantic import BaseModel

from app.modules.habits import services as svc
from app.modules.habits.models import (
    Habit,
    HabitLog,
    HabitPause,
    HabitSettings,
    HabitTimer,
    Routine,
    RoutineRun,
    RoutineStep,
    RoutineStepResult,
)
from app.modules.habits.schema import (
    CheckArgs,
    DayArgs,
    ExtendArgs,
    FinishArgs,
    HabitArgs,
    HabitLogSyncIn,
    HabitPauseSyncIn,
    HabitPublic,
    HabitSyncIn,
    IncrementArgs,
    LogPublic,
    NoArgs,
    PausePublic,
    RoutinePublic,
    RoutineRunSyncOut,
    RoutineStepPublic,
    RoutineStepSyncIn,
    RoutineSyncIn,
    RunArgs,
    SettingsIn,
    SettingsSyncOut,
    SkipArgs,
    StartRunArgs,
    StepResultSyncOut,
    TimerPublic,
)
from app.modules.sync.registry import Action, Entity, Registry
from app.shared import owned_repo
from app.shared.context import Ctx
from app.shared.domain import invalid
from app.shared.owned import OwnedRow


def _dump(schema: type[BaseModel], row: OwnedRow) -> dict[str, Any]:
    ctx_row = schema.model_validate(row)
    return ctx_row.model_dump(mode="json")


# ---------------------------------------------------------------- entities


def _upsert_habit(ctx: Ctx, row_id: uuid.UUID, payload: BaseModel) -> OwnedRow:
    assert isinstance(payload, HabitSyncIn)
    return svc.upsert_habit_sync(ctx, row_id, payload)


def _delete_habit(ctx: Ctx, row_id: uuid.UUID) -> None:
    svc.delete_habit(ctx, habit_id=row_id)


def _upsert_log(ctx: Ctx, row_id: uuid.UUID, payload: BaseModel) -> OwnedRow:
    return svc.upsert_log_sync(ctx, row_id, payload.model_dump(exclude_unset=True))


def _delete_log(ctx: Ctx, row_id: uuid.UUID) -> None:
    svc.delete_log(ctx, log_id=row_id)


def _upsert_pause(ctx: Ctx, row_id: uuid.UUID, payload: BaseModel) -> OwnedRow:
    data = payload.model_dump(exclude_unset=True)
    existing = owned_repo.get(ctx, HabitPause, row_id, include_deleted=True)
    habit_id = data.get("habit_id") or (existing.habit_id if existing else None)
    if habit_id is None:
        raise invalid("missing_fields", "A pause needs a habit")
    svc.require_habit(ctx, habit_id)
    first = data.get("from_day") or (existing.from_day if existing else None)
    last = (
        data["to_day"] if "to_day" in data else (existing.to_day if existing else None)
    )
    if first is not None and last is not None and last < first:
        raise invalid("pause_range_invalid", "A pause can't end before it starts")
    row, _ = owned_repo.upsert(ctx, HabitPause, row_id, data)
    svc.mark_today(ctx)
    return row


def _upsert_routine(ctx: Ctx, row_id: uuid.UUID, payload: BaseModel) -> OwnedRow:
    assert isinstance(payload, RoutineSyncIn)
    return svc.upsert_routine_sync(ctx, row_id, payload)


def _delete_routine(ctx: Ctx, row_id: uuid.UUID) -> None:
    svc.delete_routine(ctx, routine_id=row_id)


def _upsert_step(ctx: Ctx, row_id: uuid.UUID, payload: BaseModel) -> OwnedRow:
    return svc.upsert_step_sync(ctx, row_id, payload.model_dump(exclude_unset=True))


def _upsert_settings(ctx: Ctx, row_id: uuid.UUID, payload: BaseModel) -> OwnedRow:
    """One settings row per user whatever id the device minted: the write
    lands on the user's row (the result carries its id)."""
    del row_id
    assert isinstance(payload, SettingsIn)
    return svc.update_settings(ctx, patch=payload)


# ---------------------------------------------------------------- actions


def _log_out(row: HabitLog) -> dict[str, Any]:
    return {"log": _dump(LogPublic, row)}


def _run_out(ctx: Ctx, row: RoutineRun) -> dict[str, Any]:
    from app.modules.habits.reads import run_public

    return {"run": run_public(ctx, row).model_dump(mode="json")}


def _check(ctx: Ctx, a: dict[str, Any]) -> dict[str, Any]:
    return _log_out(
        svc.check_habit(ctx, habit_id=a["habit_id"], day=a["day"], source=a["source"])
    )


def _increment(ctx: Ctx, a: dict[str, Any]) -> dict[str, Any]:
    return _log_out(
        svc.increment_count(ctx, habit_id=a["habit_id"], by=a["by"], day=a["day"])
    )


def _skip(ctx: Ctx, a: dict[str, Any]) -> dict[str, Any]:
    return _log_out(
        svc.skip_habit(ctx, habit_id=a["habit_id"], day=a["day"], note=a["note"])
    )


def _clear(ctx: Ctx, a: dict[str, Any]) -> dict[str, Any]:
    return _log_out(svc.clear_log(ctx, habit_id=a["habit_id"], day=a["day"]))


def _timer_out(row: HabitTimer) -> dict[str, Any]:
    return {"timer": _dump(TimerPublic, row)}


def _timer_start(ctx: Ctx, a: dict[str, Any]) -> dict[str, Any]:
    return _timer_out(svc.start_timer(ctx, habit_id=a["habit_id"]))


def _timer_pause(ctx: Ctx, a: dict[str, Any]) -> dict[str, Any]:
    del a
    return _timer_out(svc.pause_timer(ctx))


def _timer_resume(ctx: Ctx, a: dict[str, Any]) -> dict[str, Any]:
    del a
    return _timer_out(svc.resume_timer(ctx))


def _timer_extend(ctx: Ctx, a: dict[str, Any]) -> dict[str, Any]:
    return _timer_out(svc.extend_timer(ctx, sec=a["sec"]))


def _timer_finish(ctx: Ctx, a: dict[str, Any]) -> dict[str, Any]:
    return _log_out(svc.finish_timer(ctx, minutes=a["minutes"]))


def _timer_discard(ctx: Ctx, a: dict[str, Any]) -> dict[str, Any]:
    del a
    svc.discard_timer(ctx)
    return {}


def _run_start(ctx: Ctx, a: dict[str, Any]) -> dict[str, Any]:
    return _run_out(
        ctx, svc.start_routine(ctx, routine_id=a["routine_id"], run_id=a["run_id"])
    )


def _run_step(fn: Callable[..., RoutineRun]) -> Callable[[Ctx, dict[str, Any]], Any]:
    def handler(ctx: Ctx, a: dict[str, Any]) -> dict[str, Any]:
        return _run_out(ctx, fn(ctx, run_id=a["run_id"]))

    return handler


RUN_STEPS: dict[str, Callable[..., RoutineRun]] = {
    "done": svc.step_done,
    "skip": svc.step_skip,
    "continue": svc.step_continue,
    "back": svc.step_back,
    "add_minute": svc.step_add_minute,
    "toggle_pause": svc.toggle_run_pause,
    "exit": svc.exit_routine,
    "abandon": svc.abandon_run,
}


def register(r: Registry) -> None:
    r.entity(
        Entity(
            name="habit",
            model=Habit,
            payload=HabitSyncIn,
            public=HabitPublic,
            upsert=_upsert_habit,
            delete=_delete_habit,
            create_required=("name",),
        )
    )
    r.entity(
        Entity(
            name="habit_log",
            model=HabitLog,
            payload=HabitLogSyncIn,
            public=LogPublic,
            upsert=_upsert_log,
            delete=_delete_log,
            create_required=("habit_id", "day", "status"),
        )
    )
    r.entity(
        Entity(
            name="habit_pause",
            model=HabitPause,
            payload=HabitPauseSyncIn,
            public=PausePublic,
            upsert=_upsert_pause,
            create_required=("habit_id", "from_day"),
        )
    )
    r.entity(
        Entity(
            name="routine",
            model=Routine,
            payload=RoutineSyncIn,
            public=RoutinePublic,
            upsert=_upsert_routine,
            delete=_delete_routine,
            create_required=("name",),
        )
    )
    r.entity(
        Entity(
            name="routine_step",
            model=RoutineStep,
            payload=RoutineStepSyncIn,
            public=RoutineStepPublic,
            upsert=_upsert_step,
            create_required=("routine_id", "habit_id", "position", "minutes"),
        )
    )
    r.entity(
        Entity(
            name="routine_run",
            model=RoutineRun,
            payload=NoArgs,
            public=RoutineRunSyncOut,
            read_only=True,
        )
    )
    r.entity(
        Entity(
            name="routine_step_result",
            model=RoutineStepResult,
            payload=NoArgs,
            public=StepResultSyncOut,
            read_only=True,
        )
    )
    r.entity(
        Entity(
            name="habit_timer",
            model=HabitTimer,
            payload=NoArgs,
            public=TimerPublic,
            read_only=True,
        )
    )
    r.entity(
        Entity(
            name="habit_settings",
            model=HabitSettings,
            payload=SettingsIn,
            public=SettingsSyncOut,
            upsert=_upsert_settings,
        )
    )

    r.action(Action(name="habits.check", handler=_check, args=CheckArgs))
    r.action(Action(name="habits.increment", handler=_increment, args=IncrementArgs))
    r.action(Action(name="habits.skip", handler=_skip, args=SkipArgs))
    r.action(Action(name="habits.clear", handler=_clear, args=DayArgs))
    r.action(Action(name="habits.timer.start", handler=_timer_start, args=HabitArgs))
    r.action(Action(name="habits.timer.pause", handler=_timer_pause, args=NoArgs))
    r.action(Action(name="habits.timer.resume", handler=_timer_resume, args=NoArgs))
    r.action(Action(name="habits.timer.extend", handler=_timer_extend, args=ExtendArgs))
    r.action(Action(name="habits.timer.finish", handler=_timer_finish, args=FinishArgs))
    r.action(Action(name="habits.timer.discard", handler=_timer_discard, args=NoArgs))
    r.action(Action(name="habits.run.start", handler=_run_start, args=StartRunArgs))
    for verb, fn in RUN_STEPS.items():
        r.action(Action(name=f"habits.run.{verb}", handler=_run_step(fn), args=RunArgs))
