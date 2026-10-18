"""Cross-module contract of the habits module (implemented by habits).

None of these commit: the calling use case does (see ``app.shared.context``).
"""

import uuid
from datetime import date
from typing import Literal

from app.modules.habits import services as svc
from app.modules.habits.models import Habit, HabitLog, Routine, RoutineRun
from app.modules.habits.schema import EVERY_DAY, HabitCreate, ScheduleSlot
from app.shared.context import Ctx

LogSource = Literal["tap", "timer", "routine", "capture", "workout"]


def log_habit(
    ctx: Ctx,
    *,
    habit_id: uuid.UUID,
    day: date,
    value: float | None = None,
    add: bool = False,
    status: Literal["done", "partial", "skipped"] | None = None,
    source: LogSource = "tap",
    note: str | None = None,
    log_id: uuid.UUID | None = None,
) -> HabitLog:
    """Create-or-edit the (habit, day) log. Status defaults from value vs
    target: ``value >= target`` done, else partial; check habits are done."""
    return svc._log(
        ctx,
        habit=svc.require_habit(ctx, habit_id),
        day=day,
        value=value,
        add=add,
        status=status,
        source=source,
        note=note,
        log_id=log_id,
    )


def delete_log(ctx: Ctx, *, log_id: uuid.UUID) -> None:
    svc._delete_log(ctx, log_id=log_id)


def restore_log(ctx: Ctx, *, log_id: uuid.UUID) -> HabitLog:
    return svc._restore_log(ctx, log_id=log_id)


def create_habit(
    ctx: Ctx,
    *,
    name: str,
    icon: str = "✅",
    type: Literal["check", "duration", "count"] = "check",
    target: float | None = None,
    unit: str | None = None,
    days: list[int] | None = None,
    time: str | None = None,
    habit_id: uuid.UUID | None = None,
) -> Habit:
    return svc._create_habit(
        ctx,
        data=HabitCreate(
            id=habit_id,
            name=name,
            icon=icon,
            type=type,
            target=target,
            unit=unit,
            schedule=(
                [ScheduleSlot(days=days or EVERY_DAY, time=time)]
                if days is not None or time is not None
                else None
            ),
        ),
    )


def start_routine(
    ctx: Ctx, *, routine_id: uuid.UUID, run_id: uuid.UUID | None = None
) -> RoutineRun:
    return svc._start_routine(ctx, routine_id=routine_id, run_id=run_id)


def find_habits(ctx: Ctx, query: str, *, limit: int = 5) -> list[Habit]:
    """Active habits whose name matches ``query`` (case-insensitive, best
    first)."""
    return svc.find_habits(ctx, query, limit=limit)


def find_routines(ctx: Ctx, query: str, *, limit: int = 5) -> list[Routine]:
    return svc.find_routines(ctx, query, limit=limit)


def auto_check_workout_habits(
    ctx: Ctx, *, day: date, workout_id: uuid.UUID
) -> list[HabitLog]:
    """Tick every non-archived habit with ``link_workout``, scheduled or not
    on ``day``, that is not already done that day (IA ruling X-7; the
    prototype's ``autoCheckWorkoutHabits`` also overwrites a skipped or
    partial log). A new log's id is
    ``derived_id("workout-habit", workout_id, str(habit_id))``; an existing
    log for the day keeps its id."""
    return svc.auto_check_workout_habits(ctx, day=day, workout_id=workout_id)
