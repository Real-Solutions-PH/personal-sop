"""Rows to the pure views ``logic.py`` computes over.

Days of instants (``created_at``, ``archived_at``) resolve through the user's
:class:`~app.shared.day.DayClock`, never the UTC calendar.
"""

import uuid
from collections import defaultdict
from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from datetime import date

from sqlmodel import col

from app.modules.habits import logic as L
from app.modules.habits.models import (
    Habit,
    HabitLog,
    HabitPause,
    Routine,
    RoutineRun,
    RoutineStep,
    RoutineStepResult,
)
from app.shared import owned_repo
from app.shared.context import Ctx


def slots(raw: Iterable[dict[str, object]]) -> tuple[L.Slot, ...]:
    out: list[L.Slot] = []
    for s in raw:
        days = s.get("days") or []
        window = s.get("window")
        time = s.get("time")
        out.append(
            L.Slot(
                days=tuple(int(d) for d in days),  # type: ignore[attr-defined]
                time=str(time) if time else None,
                window=int(window) if isinstance(window, int | float) else None,
            )
        )
    return tuple(out)


def habit_view(ctx: Ctx, h: Habit, pauses: Sequence[HabitPause] = ()) -> L.HabitView:
    return L.HabitView(
        id=str(h.id),
        name=h.name,
        type=h.type,
        schedule=slots(h.schedule),
        created=ctx.clock.day_of(h.created_at),
        status=h.status,
        pauses=tuple(
            L.Pause(from_day=p.from_day, to_day=p.to_day)
            for p in sorted(pauses, key=lambda p: p.from_day)
        ),
        archived=ctx.clock.day_of(h.archived_at) if h.archived_at else None,
        sort_order=h.sort_order,
        icon=h.icon,
        target=h.target,
    )


def log_view(lg: HabitLog) -> L.LogView:
    return L.LogView(
        habit_id=str(lg.habit_id),
        day=lg.day,
        status=lg.status,
        logged_at=lg.logged_at,
        value=lg.value,
    )


def routine_view(
    ctx: Ctx, r: Routine, steps: Sequence[RoutineStep] = ()
) -> L.RoutineView:
    return L.RoutineView(
        id=str(r.id),
        name=r.name,
        schedule=slots(r.schedule),
        created=ctx.clock.day_of(r.created_at),
        status=r.status,
        steps=tuple(
            L.StepView(habit_id=str(s.habit_id), minutes=s.minutes)
            for s in sorted(steps, key=lambda s: s.position)
        ),
        icon=r.icon,
    )


def run_steps(run: RoutineRun) -> tuple[L.StepView, ...]:
    return tuple(
        L.StepView(habit_id=str(s["habit_id"]), minutes=int(str(s["minutes"])))
        for s in run.steps
    )


def run_view(run: RoutineRun, results: Sequence[RoutineStepResult]) -> L.RunView:
    ordered = sorted(results, key=lambda r: r.position)
    return L.RunView(
        id=str(run.id),
        routine_id=str(run.routine_id),
        day=run.day,
        state=run.state,
        steps=run_steps(run),
        results=tuple(
            L.ResultView(
                habit_id=str(r.habit_id), status=r.status, actual_sec=r.actual_sec
            )
            for r in ordered
        ),
        current=run.current,
        step_started_at=run.step_started_at,
        paused_at=run.paused_at,
        step_paused_sec=run.step_paused_sec,
    )


@dataclass
class World:
    """Everything the read screens compute over, loaded once per request."""

    habits: list[Habit]
    views: dict[uuid.UUID, L.HabitView]
    idx: L.LogIndex
    routines: list[Routine]
    routine_views: dict[uuid.UUID, L.RoutineView]
    runs: list[RoutineRun]
    run_views: dict[uuid.UUID, L.RunView]
    results: dict[uuid.UUID, list[RoutineStepResult]]
    steps: dict[uuid.UUID, list[RoutineStep]]

    def habit_list(self) -> list[L.HabitView]:
        return [self.views[h.id] for h in self.habits]

    def active_views(self) -> list[L.HabitView]:
        return [v for v in self.habit_list() if v.status != "archived"]


def pauses_by_habit(ctx: Ctx) -> dict[uuid.UUID, list[HabitPause]]:
    out: dict[uuid.UUID, list[HabitPause]] = defaultdict(list)
    for p in owned_repo.list_rows(ctx, HabitPause):
        out[p.habit_id].append(p)
    return out


def load_world(ctx: Ctx, *, since: date | None = None) -> World:
    """Load the user's habits, logs (from ``since`` when given), routines and
    runs. One habit's history is bounded by the user's own data, which is the
    unit every screen computes over."""
    habits = owned_repo.list_rows(
        ctx, Habit, order_by=(col(Habit.sort_order), col(Habit.created_at))
    )
    pauses = pauses_by_habit(ctx)
    views = {h.id: habit_view(ctx, h, pauses.get(h.id, ())) for h in habits}
    where = [col(HabitLog.day) >= since] if since else []
    logs = owned_repo.list_rows(ctx, HabitLog, *where)
    routines = owned_repo.list_rows(ctx, Routine, order_by=(col(Routine.created_at),))
    steps: dict[uuid.UUID, list[RoutineStep]] = defaultdict(list)
    for s in owned_repo.list_rows(
        ctx, RoutineStep, order_by=(col(RoutineStep.position),)
    ):
        steps[s.routine_id].append(s)
    runs = owned_repo.list_rows(ctx, RoutineRun, order_by=(col(RoutineRun.started_at),))
    results: dict[uuid.UUID, list[RoutineStepResult]] = defaultdict(list)
    for res in owned_repo.list_rows(ctx, RoutineStepResult):
        results[res.run_id].append(res)
    return World(
        habits=habits,
        views=views,
        idx=L.log_index(log_view(lg) for lg in logs),
        routines=routines,
        routine_views={
            r.id: routine_view(ctx, r, steps.get(r.id, ())) for r in routines
        },
        runs=runs,
        run_views={x.id: run_view(x, results.get(x.id, ())) for x in runs},
        results=results,
        steps=steps,
    )
