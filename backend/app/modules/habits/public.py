"""Cross-module contract of the habits module (implemented by habits).

None of these commit: the calling use case does (see ``app.shared.context``).
"""

import uuid
from datetime import date
from typing import Literal

from app.modules.habits.models import Habit, HabitLog, Routine, RoutineRun
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
    raise NotImplementedError


def delete_log(ctx: Ctx, *, log_id: uuid.UUID) -> None:
    raise NotImplementedError


def restore_log(ctx: Ctx, *, log_id: uuid.UUID) -> HabitLog:
    raise NotImplementedError


def create_habit(
    ctx: Ctx,
    *,
    name: str,
    icon: str = "check",
    type: Literal["check", "duration", "count"] = "check",
    target: float | None = None,
    unit: str | None = None,
    days: list[int] | None = None,
    time: str | None = None,
    habit_id: uuid.UUID | None = None,
) -> Habit:
    raise NotImplementedError


def start_routine(
    ctx: Ctx, *, routine_id: uuid.UUID, run_id: uuid.UUID | None = None
) -> RoutineRun:
    raise NotImplementedError


def find_habits(ctx: Ctx, query: str, *, limit: int = 5) -> list[Habit]:
    """Active habits whose name matches ``query`` (case-insensitive, best
    first)."""
    raise NotImplementedError


def find_routines(ctx: Ctx, query: str, *, limit: int = 5) -> list[Routine]:
    raise NotImplementedError


def auto_check_workout_habits(
    ctx: Ctx, *, day: date, workout_id: uuid.UUID
) -> list[HabitLog]:
    """Tick every active habit with ``link_workout`` scheduled (or not) on
    ``day`` that has no log yet (IA ruling X-7). Log ids are
    ``derived_id("workout-habit", workout_id, str(habit_id))``."""
    raise NotImplementedError
