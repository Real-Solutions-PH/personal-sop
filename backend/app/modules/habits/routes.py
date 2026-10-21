"""REST routes of the habits module: one endpoint per screen read and per
screen action. Static paths are declared before ``/{id}`` ones so they are
never parsed as an id."""

import uuid
from collections.abc import Callable
from datetime import date
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, Query

from app.modules.habits import reads
from app.modules.habits import services as svc
from app.modules.habits.models import RoutineRun
from app.modules.habits.schema import (
    ArchivedPublic,
    CheckIn,
    DayIn,
    DayPublic,
    ExtendIn,
    FinishIn,
    FinishOut,
    HabitCreate,
    HabitDetail,
    HabitPublic,
    HabitsHome,
    HabitsPublic,
    HabitUpdate,
    IncrementIn,
    LogIn,
    LogPublic,
    LogsPublic,
    PauseIn,
    PlayerState,
    ReorderIn,
    RoutineCreate,
    RoutineDetail,
    RoutinePublic,
    RoutinesPublic,
    RoutineStepPublic,
    RoutineUpdate,
    RunPublic,
    RunSummary,
    SettingsIn,
    SettingsPublic,
    SkipIn,
    SortKey,
    StepsIn,
    TimerPublic,
    TimerState,
    TodayPublic,
)
from app.modules.iam.deps import require_permission
from app.shared.context import CtxDep
from app.shared.pagination import PaginationDep
from app.shared.rate_limit import rate_limited
from app.shared.schema import Message

router = APIRouter(prefix="/habits", tags=["habits"])

READ = [Depends(require_permission("habits:read"))]
WRITE = [rate_limited("habits"), Depends(require_permission("habits:write"))]

Period = Annotated[int, Query(ge=1, le=366)]


# ---------------------------------------------------------------- screens


@router.get("/home", response_model=HabitsHome, dependencies=READ)
def habits_home(ctx: CtxDep, days: Period = 30, sort: SortKey = "rate") -> Any:
    """Habits analytics (HAB-16) for a period of ``days``."""
    return reads.home(ctx, days=days, sort=sort)


@router.get("/today", response_model=TodayPublic, dependencies=READ)
def habits_today(ctx: CtxDep) -> Any:
    """Today's habits card and routine CTAs (HAB-C1, HAB-C2)."""
    return reads.today_view(ctx)


@router.get("/archived", response_model=ArchivedPublic, dependencies=READ)
def archived_habits(ctx: CtxDep, page: PaginationDep) -> Any:
    rows, count = reads.archived_list(ctx, skip=page.skip, limit=page.limit)
    return ArchivedPublic(data=rows, count=count)


# ---------------------------------------------------------------- settings


@router.get("/settings", response_model=SettingsPublic, dependencies=READ)
def read_settings(ctx: CtxDep) -> Any:
    return svc.get_settings(ctx)


@router.patch("/settings", response_model=SettingsPublic, dependencies=WRITE)
def update_settings(ctx: CtxDep, body: SettingsIn) -> Any:
    return svc.update_settings(ctx, patch=body)


# ---------------------------------------------------------------- timer


@router.get("/timer", response_model=TimerState, dependencies=READ)
def read_timer(ctx: CtxDep) -> Any:
    return reads.timer_state(ctx)


@router.post("/timer/pause", response_model=TimerPublic, dependencies=WRITE)
def pause_timer(ctx: CtxDep) -> Any:
    return svc.pause_timer(ctx)


@router.post("/timer/resume", response_model=TimerPublic, dependencies=WRITE)
def resume_timer(ctx: CtxDep) -> Any:
    return svc.resume_timer(ctx)


@router.post("/timer/extend", response_model=TimerPublic, dependencies=WRITE)
def extend_timer(ctx: CtxDep, body: ExtendIn) -> Any:
    return svc.extend_timer(ctx, sec=body.sec)


@router.post("/timer/finish", response_model=FinishOut, dependencies=WRITE)
def finish_timer(ctx: CtxDep, body: FinishIn) -> Any:
    return FinishOut(
        log=LogPublic.model_validate(svc.finish_timer(ctx, minutes=body.minutes))
    )


@router.post("/timer/discard", response_model=Message, dependencies=WRITE)
def discard_timer(ctx: CtxDep) -> Any:
    svc.discard_timer(ctx)
    return Message(message="Timer discarded")


# ---------------------------------------------------------------- day editor


@router.get("/day/{day}", response_model=DayPublic, dependencies=READ)
def read_day(ctx: CtxDep, day: date) -> Any:
    return reads.day_view(ctx, day=day)


@router.put("/day/{day}", response_model=DayPublic, dependencies=WRITE)
def save_day(ctx: CtxDep, day: date, body: DayIn) -> Any:
    svc.set_day(
        ctx,
        day=day,
        entries=[(e.habit_id, e.status, e.value, e.note) for e in body.entries],
    )
    return reads.day_view(ctx, day=day)


# ---------------------------------------------------------------- logs by id


@router.delete("/logs/{log_id}", response_model=Message, dependencies=WRITE)
def delete_log(ctx: CtxDep, log_id: uuid.UUID) -> Any:
    svc.delete_log(ctx, log_id=log_id)
    return Message(message="Log deleted")


@router.post("/logs/{log_id}/restore", response_model=LogPublic, dependencies=WRITE)
def restore_log(ctx: CtxDep, log_id: uuid.UUID) -> Any:
    return svc.restore_log(ctx, log_id=log_id)


# ---------------------------------------------------------------- routines


@router.get("/routines", response_model=RoutinesPublic, dependencies=READ)
def list_routines(ctx: CtxDep, page: PaginationDep, archived: bool = False) -> Any:
    rows, count = reads.routine_list(
        ctx, archived=archived, skip=page.skip, limit=page.limit
    )
    return RoutinesPublic(data=rows, count=count)


@router.post("/routines", response_model=RoutinePublic, dependencies=WRITE)
def create_routine(ctx: CtxDep, body: RoutineCreate) -> Any:
    return svc.create_routine(ctx, data=body)


@router.get("/routines/{routine_id}", response_model=RoutineDetail, dependencies=READ)
def read_routine(ctx: CtxDep, routine_id: uuid.UUID) -> Any:
    return reads.routine_detail(ctx, routine_id=routine_id)


@router.patch(
    "/routines/{routine_id}", response_model=RoutinePublic, dependencies=WRITE
)
def update_routine(ctx: CtxDep, routine_id: uuid.UUID, body: RoutineUpdate) -> Any:
    return svc.update_routine(ctx, routine_id=routine_id, patch=body)


@router.delete("/routines/{routine_id}", response_model=Message, dependencies=WRITE)
def delete_routine(ctx: CtxDep, routine_id: uuid.UUID) -> Any:
    svc.delete_routine(ctx, routine_id=routine_id)
    return Message(message="Routine deleted")


@router.put(
    "/routines/{routine_id}/steps",
    response_model=list[RoutineStepPublic],
    dependencies=WRITE,
)
def set_steps(ctx: CtxDep, routine_id: uuid.UUID, body: StepsIn) -> Any:
    return svc.set_routine_steps(ctx, routine_id=routine_id, steps=body.steps)


@router.post(
    "/routines/{routine_id}/archive", response_model=RoutinePublic, dependencies=WRITE
)
def archive_routine(ctx: CtxDep, routine_id: uuid.UUID) -> Any:
    return svc.archive_routine(ctx, routine_id=routine_id)


@router.post(
    "/routines/{routine_id}/restore", response_model=RoutinePublic, dependencies=WRITE
)
def restore_routine(ctx: CtxDep, routine_id: uuid.UUID) -> Any:
    return svc.restore_routine(ctx, routine_id=routine_id)


@router.post(
    "/routines/{routine_id}/start", response_model=PlayerState, dependencies=WRITE
)
def start_routine(
    ctx: CtxDep, routine_id: uuid.UUID, run_id: uuid.UUID | None = None
) -> Any:
    """Start or resume today's run; 409 ``live_session_busy`` when something
    else holds the Live bar."""
    run = svc.start_routine(ctx, routine_id=routine_id, run_id=run_id)
    return reads.player_state(ctx, svc.require_routine(ctx, routine_id), run)


@router.get(
    "/routines/{routine_id}/play",
    response_model=PlayerState | None,
    dependencies=READ,
)
def read_player(ctx: CtxDep, routine_id: uuid.UUID) -> Any:
    """The player (HAB-14): today's in-progress run, or null to offer Start."""
    return reads.player(ctx, routine_id=routine_id)


# ---------------------------------------------------------------- runs

RunVerb = Literal[
    "done", "skip", "continue", "back", "add-minute", "toggle-pause", "exit"
]
RUN_VERBS: dict[str, Callable[..., RoutineRun]] = {
    "done": svc.step_done,
    "skip": svc.step_skip,
    "continue": svc.step_continue,
    "back": svc.step_back,
    "add-minute": svc.step_add_minute,
    "toggle-pause": svc.toggle_run_pause,
    "exit": svc.exit_routine,
}


@router.get("/runs/{run_id}", response_model=RunSummary, dependencies=READ)
def run_summary(ctx: CtxDep, run_id: uuid.UUID) -> Any:
    """The run summary (HAB-15)."""
    return reads.run_summary(ctx, run_id=run_id)


@router.post("/runs/{run_id}/{verb}", response_model=RunPublic, dependencies=WRITE)
def run_action(ctx: CtxDep, run_id: uuid.UUID, verb: RunVerb) -> Any:
    """Player controls: Done, Skip, Continue (already logged), Back, +1 min,
    Pause/Resume, Exit (the run stays resumable today)."""
    run = RUN_VERBS[verb](ctx, run_id=run_id)
    return reads.run_public(ctx, run)


# ---------------------------------------------------------------- habits


@router.get("/", response_model=HabitsPublic, dependencies=READ)
def list_habits(
    ctx: CtxDep,
    page: PaginationDep,
    status: Literal["active", "paused"] | None = None,
) -> Any:
    """The habits list (HAB-01), manual order; ``status`` is the paused chip."""
    rows, count = reads.habit_list(ctx, status=status, skip=page.skip, limit=page.limit)
    return HabitsPublic(data=rows, count=count)


@router.post("/", response_model=HabitPublic, dependencies=WRITE)
def create_habit(ctx: CtxDep, body: HabitCreate) -> Any:
    return svc.create_habit(ctx, data=body)


@router.get("/{habit_id}", response_model=HabitDetail, dependencies=READ)
def read_habit(ctx: CtxDep, habit_id: uuid.UUID, days: Period = 91) -> Any:
    """Habit detail (HAB-02) with a heatmap of ``days`` cells ending today."""
    return reads.habit_detail(ctx, habit_id=habit_id, days=days)


@router.patch("/{habit_id}", response_model=HabitPublic, dependencies=WRITE)
def update_habit(ctx: CtxDep, habit_id: uuid.UUID, body: HabitUpdate) -> Any:
    return svc.update_habit(ctx, habit_id=habit_id, patch=body)


@router.delete("/{habit_id}", response_model=Message, dependencies=WRITE)
def delete_habit(ctx: CtxDep, habit_id: uuid.UUID) -> Any:
    svc.delete_habit(ctx, habit_id=habit_id)
    return Message(message="Habit deleted")


@router.post("/{habit_id}/pause", response_model=HabitPublic, dependencies=WRITE)
def pause_habit(ctx: CtxDep, habit_id: uuid.UUID, body: PauseIn) -> Any:
    return svc.pause_habit(ctx, habit_id=habit_id, until=body.until, reason=body.reason)


@router.post("/{habit_id}/resume", response_model=HabitPublic, dependencies=WRITE)
def resume_habit(ctx: CtxDep, habit_id: uuid.UUID) -> Any:
    return svc.resume_habit(ctx, habit_id=habit_id)


@router.post("/{habit_id}/archive", response_model=HabitPublic, dependencies=WRITE)
def archive_habit(ctx: CtxDep, habit_id: uuid.UUID) -> Any:
    return svc.archive_habit(ctx, habit_id=habit_id)


@router.post("/{habit_id}/restore", response_model=HabitPublic, dependencies=WRITE)
def restore_habit(ctx: CtxDep, habit_id: uuid.UUID) -> Any:
    return svc.restore_habit(ctx, habit_id=habit_id)


@router.post(
    "/{habit_id}/reorder", response_model=list[HabitPublic], dependencies=WRITE
)
def reorder_habit(ctx: CtxDep, habit_id: uuid.UUID, body: ReorderIn) -> Any:
    return svc.reorder_habit(ctx, habit_id=habit_id, direction=body.dir)


@router.get("/{habit_id}/logs", response_model=LogsPublic, dependencies=READ)
def list_logs(ctx: CtxDep, habit_id: uuid.UUID, page: PaginationDep) -> Any:
    rows, count = reads.habit_logs(
        ctx, habit_id=habit_id, skip=page.skip, limit=page.limit
    )
    return LogsPublic(data=[LogPublic.model_validate(r) for r in rows], count=count)


@router.post("/{habit_id}/log", response_model=LogPublic, dependencies=WRITE)
def log_habit(ctx: CtxDep, habit_id: uuid.UUID, body: LogIn) -> Any:
    """The log sheet (HAB-05): status / value / note / day. Re-logging a day
    edits its log; ``add`` adds the value to it."""
    return svc.log_habit(
        ctx,
        habit_id=habit_id,
        day=body.day,
        value=body.value,
        add=body.add,
        status=body.status,
        source=body.source,
        note=body.note,
        log_id=body.id,
    )


@router.post("/{habit_id}/check", response_model=LogPublic, dependencies=WRITE)
def check_habit(ctx: CtxDep, habit_id: uuid.UUID, body: CheckIn) -> Any:
    return svc.check_habit(ctx, habit_id=habit_id, day=body.day, source=body.source)


@router.post("/{habit_id}/increment", response_model=LogPublic, dependencies=WRITE)
def increment_habit(ctx: CtxDep, habit_id: uuid.UUID, body: IncrementIn) -> Any:
    return svc.increment_count(ctx, habit_id=habit_id, by=body.by, day=body.day)


@router.post("/{habit_id}/skip", response_model=LogPublic, dependencies=WRITE)
def skip_habit(ctx: CtxDep, habit_id: uuid.UUID, body: SkipIn) -> Any:
    return svc.skip_habit(ctx, habit_id=habit_id, day=body.day, note=body.note)


@router.delete("/{habit_id}/log", response_model=LogPublic, dependencies=WRITE)
def clear_log(ctx: CtxDep, habit_id: uuid.UUID, day: date | None = None) -> Any:
    """Undo (F-HAB-02): removes the day's log and returns it for the toast."""
    return svc.clear_log(ctx, habit_id=habit_id, day=day)


@router.post("/{habit_id}/timer", response_model=TimerPublic, dependencies=WRITE)
def start_timer(ctx: CtxDep, habit_id: uuid.UUID) -> Any:
    """Start (or return) this habit's timer; 409 ``live_session_busy`` when
    another timer, routine or workout holds the Live bar."""
    return svc.start_timer(ctx, habit_id=habit_id)
