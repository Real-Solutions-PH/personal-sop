"""Cross-module contract of the habits module (implemented by habits).

None of these commit: the calling use case does (see ``app.shared.context``).
"""

import uuid
from datetime import date, timedelta
from typing import Literal

from sqlmodel import col

from app.modules.habits import logic as logic
from app.modules.habits import services as svc
from app.modules.habits import views
from app.modules.habits.models import Habit, HabitLog, Routine, RoutineRun
from app.modules.habits.schema import EVERY_DAY, HabitCreate, ScheduleSlot
from app.shared import owned_repo
from app.shared.context import Ctx

# ``logic`` is re-exported for read-only use: the deterministic Q&A computes
# streaks, due days and completion over ``load_world`` with it.

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


def delete_habit(ctx: Ctx, *, habit_id: uuid.UUID) -> None:
    """Delete a habit, its logs and pauses, and drop it from every routine
    (the undo of a habit a capture created)."""
    svc._delete_habit(ctx, habit_id)


def get_log(ctx: Ctx, *, habit_id: uuid.UUID, day: date) -> HabitLog | None:
    """The live (habit, day) log, if any."""
    return owned_repo.find_one(
        ctx, HabitLog, col(HabitLog.habit_id) == habit_id, col(HabitLog.day) == day
    )


def current_streak(ctx: Ctx, *, habit_id: uuid.UUID) -> int:
    """The habit's current streak as of today (0 for an unknown habit)."""
    w = views.load_world(ctx, since=ctx.today - timedelta(days=400))
    v = w.views.get(habit_id)
    return logic.streaks(v, w.idx, ctx.today).current if v else 0


def list_habits(ctx: Ctx) -> list[Habit]:
    """Every habit, archived included, in the user's order."""
    return owned_repo.list_rows(
        ctx, Habit, order_by=[col(Habit.sort_order), col(Habit.created_at)]
    )


def list_routines(ctx: Ctx) -> list[Routine]:
    """Every routine, oldest first."""
    return owned_repo.list_rows(ctx, Routine, order_by=[col(Routine.created_at)])


def load_world(ctx: Ctx, *, since: date) -> views.World:
    """Habits, logs from ``since``, routines and runs: the input to every
    ``logic`` calculation."""
    return views.load_world(ctx, since=since)
