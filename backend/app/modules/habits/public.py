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
from app.modules.habits.schema import (
    EVERY_DAY,
    HabitCreate,
    RoutineCreate,
    ScheduleSlot,
    StepIn,
)
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


def create_routine(
    ctx: Ctx,
    *,
    name: str,
    icon: str = "🌅",
    steps: list[tuple[uuid.UUID, int]],
    days: list[int] | None = None,
    time: str | None = None,
    routine_id: uuid.UUID | None = None,
) -> Routine:
    """A routine of existing habits, ``(habit_id, minutes)`` in order, on
    ``days`` (0 = Sunday; every day by default) at ``time``."""
    return svc._create_routine(
        ctx,
        data=RoutineCreate(
            id=routine_id,
            name=name,
            icon=icon,
            schedule=[ScheduleSlot(days=days or EVERY_DAY, time=time)],
            steps=[StepIn(habit_id=h, minutes=m) for h, m in steps],
        ),
    )


def delete_routine(ctx: Ctx, *, routine_id: uuid.UUID) -> None:
    """Delete a routine, its steps and runs (its habits stay)."""
    svc._delete_routine(ctx, routine_id)


# ---------------------------------------------------------------- edits
# Changing a habit or routine from chat: the change, the state before it
# (for Undo), and putting that state back. Flush only, like the rest.


def _slot(schedule: list[dict[str, object]]) -> dict[str, object]:
    return dict(schedule[0]) if schedule else {"days": list(EVERY_DAY)}


def _reschedule(
    schedule: list[dict[str, object]], days: list[int] | None, time: str | None
) -> list[dict[str, object]]:
    """The schedule with its first slot's days and/or time changed (a
    single-slot schedule is what chat makes and edits)."""
    slot = _slot(schedule)
    if days is not None:
        slot["days"] = days
    if time is not None:
        slot["time"] = time
    return [slot, *schedule[1:]]


def routine_state(ctx: Ctx, routine_id: uuid.UUID) -> dict[str, object]:
    """What :func:`restore_routine` needs to put a routine back."""
    r = svc.require_routine(ctx, routine_id)
    return {
        "name": r.name,
        "icon": r.icon,
        "schedule": r.schedule,
        "steps": [
            {"habit_id": str(s.habit_id), "minutes": s.minutes}
            for s in svc._steps(ctx, routine_id)
        ],
    }


def edit_routine(
    ctx: Ctx,
    *,
    routine_id: uuid.UUID,
    name: str | None = None,
    icon: str | None = None,
    days: list[int] | None = None,
    time: str | None = None,
    steps: list[tuple[uuid.UUID, int]] | None = None,
) -> Routine:
    """Rename, re-icon, reschedule and/or replace the steps of a routine
    (``steps`` is the whole new list, in order)."""
    r = svc.require_routine(ctx, routine_id)
    if name is not None:
        r.name = name
    if icon is not None:
        r.icon = icon
    if days is not None or time is not None:
        r.schedule = _reschedule(r.schedule, days, time)
    ctx.session.add(r)
    if steps is not None:
        svc._write_steps(
            ctx, routine_id, [StepIn(habit_id=h, minutes=m) for h, m in steps]
        )
    ctx.session.flush()
    svc.mark_today(ctx)
    return r


def restore_routine(
    ctx: Ctx, *, routine_id: uuid.UUID, state: dict[str, object]
) -> None:
    r = svc.require_routine(ctx, routine_id)
    r.name = str(state["name"])
    r.icon = str(state["icon"])
    r.schedule = list(state["schedule"])  # type: ignore[call-overload]
    ctx.session.add(r)
    svc._write_steps(
        ctx,
        routine_id,
        [
            StepIn(habit_id=uuid.UUID(str(s["habit_id"])), minutes=int(s["minutes"]))
            for s in state["steps"]  # type: ignore[attr-defined]
        ],
    )
    ctx.session.flush()
    svc.mark_today(ctx)


HABIT_FIELDS = ("name", "icon", "type", "target", "unit", "schedule")


def habit_state(ctx: Ctx, habit_id: uuid.UUID) -> dict[str, object]:
    """What :func:`restore_habit` needs to put a habit back."""
    h = svc.require_habit(ctx, habit_id)
    return {k: getattr(h, k) for k in HABIT_FIELDS}


def edit_habit(
    ctx: Ctx,
    *,
    habit_id: uuid.UUID,
    name: str | None = None,
    icon: str | None = None,
    target: float | None = None,
    unit: str | None = None,
    days: list[int] | None = None,
    time: str | None = None,
) -> Habit:
    """Rename, re-icon, change the target or unit, or reschedule a habit.
    A target on a check habit makes it a count."""
    h = svc.require_habit(ctx, habit_id)
    if name is not None:
        h.name = name
    if icon is not None:
        h.icon = icon
    if target is not None:
        h.target = target
        if h.type == "check":
            h.type = "count"
    if unit is not None:
        h.unit = unit
    if days is not None or time is not None:
        h.schedule = _reschedule(h.schedule, days, time)
    ctx.session.add(h)
    ctx.session.flush()
    svc.mark_today(ctx)
    return h


def restore_habit(ctx: Ctx, *, habit_id: uuid.UUID, state: dict[str, object]) -> None:
    h = svc.require_habit(ctx, habit_id)
    owned_repo.apply(h, {k: state[k] for k in HABIT_FIELDS if k in state})
    ctx.session.add(h)
    ctx.session.flush()
    svc.mark_today(ctx)


def set_habit_archived(ctx: Ctx, *, habit_id: uuid.UUID, archived: bool) -> None:
    """Archive a habit from chat (its history stays), or bring it back."""
    row = svc.require_habit(ctx, habit_id)
    row.status = "archived" if archived else "active"
    row.archived_at = ctx.now if archived else None
    ctx.session.add(row)
    ctx.session.flush()
    svc._dirty(ctx, ctx.today)


def set_routine_archived(ctx: Ctx, *, routine_id: uuid.UUID, archived: bool) -> None:
    """Archive a routine from chat, or bring it back."""
    row = svc.require_routine(ctx, routine_id)
    row.status = "archived" if archived else "active"
    ctx.session.add(row)
    ctx.session.flush()
    svc._dirty(ctx, ctx.today)
