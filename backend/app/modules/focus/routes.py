"""REST routes of the focus module (ADR-0025). The phone writes through
``/sync``; these serve its reads, Fern and anything that drives the timer
over HTTP. Static paths come before ``/{id}`` ones."""

import uuid
from datetime import date, timedelta
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, Query
from sqlmodel import col

from app.modules.focus import services as svc
from app.modules.focus.models import FocusSession
from app.modules.focus.schema import (
    DayOut,
    DayTotal,
    ExtendIn,
    ItemTimeOut,
    RangeOut,
    SessionDetail,
    SessionPublic,
    SessionsOut,
    SettingsIn,
    SettingsPublic,
    StartIn,
    StopIn,
    SwitchIn,
    TodayOut,
)
from app.modules.iam.deps import require_permission
from app.shared import owned_repo
from app.shared.context import CtxDep
from app.shared.domain import invalid
from app.shared.pagination import PaginationDep
from app.shared.rate_limit import rate_limited
from app.shared.schema import Message

router = APIRouter(prefix="/focus", tags=["focus"])

READ = [Depends(require_permission("focus:read"))]
WRITE = [rate_limited("focus"), Depends(require_permission("focus:write"))]


# ---------------------------------------------------------------- reads


@router.get("/today", response_model=TodayOut, dependencies=READ)
def focus_today(ctx: CtxDep) -> Any:
    """Today's focus against the goal, by item, the goal streak and the
    session running now."""
    return svc.today_view(ctx)


@router.get("/range", response_model=RangeOut, dependencies=READ)
def focus_range(
    ctx: CtxDep,
    first: Annotated[date | None, Query()] = None,
    last: Annotated[date | None, Query()] = None,
) -> Any:
    """Focus per business day over ``first..last`` (default the last 7
    days), with focus by item and the goal streaks."""
    last = last or ctx.today
    first = first or last - timedelta(days=6)
    if last < first or (last - first).days > 366:
        raise invalid("range_invalid", "Pick a range of at most a year")
    r = svc.focus_range(ctx, first, last)
    goal = svc.goal_sec(ctx)
    current, best = svc.streaks(ctx)
    return RangeOut(
        first=first,
        last=last,
        goal_min=goal // 60,
        days=[
            DayTotal(day=d, focus_sec=s, on_goal=goal > 0 and s >= goal)
            for d, s in sorted(r.by_day.items())
        ],
        items=svc.item_times(r.spans),
        focus_sec=sum(r.by_day.values()),
        streak=current,
        best_streak=best,
    )


@router.get("/day", response_model=DayOut, dependencies=READ)
def focus_day(ctx: CtxDep, day: Annotated[date | None, Query()] = None) -> Any:
    """The day timeline: every focus, break and pause span on one business
    day, clipped to it."""
    d = day or ctx.today
    lo, hi, blocks = svc.day_blocks(ctx, d)
    r = svc.focus_range(ctx, d, d)
    return DayOut(
        day=d,
        starts_at=lo,
        ends_at=hi,
        focus_sec=r.by_day.get(d, 0),
        goal_min=svc.get_settings(ctx).daily_goal_min,
        blocks=blocks,
    )


@router.get("/items/{kind}/{item_id}", response_model=ItemTimeOut, dependencies=READ)
def focus_item(ctx: CtxDep, kind: Literal["task", "habit"], item_id: uuid.UUID) -> Any:
    """Time spent on one task or habit, and its recent sessions."""
    return svc.item_time(ctx, kind=kind, item_id=item_id)


@router.get("/settings", response_model=SettingsPublic, dependencies=READ)
def get_settings(ctx: CtxDep) -> Any:
    return svc.get_settings(ctx)


@router.put("/settings", response_model=SettingsPublic, dependencies=WRITE)
def put_settings(ctx: CtxDep, body: SettingsIn) -> Any:
    return svc.update_settings(ctx, patch=body)


@router.get("/sessions", response_model=SessionsOut, dependencies=READ)
def list_sessions(
    ctx: CtxDep,
    pagination: PaginationDep,
    day: Annotated[date | None, Query()] = None,
) -> Any:
    """Sessions newest first; ``day`` narrows them to one business day."""
    where = [col(FocusSession.day) == day] if day else []
    rows = owned_repo.list_rows(
        ctx,
        FocusSession,
        *where,
        order_by=[col(FocusSession.started_at).desc()],
        skip=pagination.skip,
        limit=pagination.limit,
    )
    return SessionsOut(
        data=[SessionPublic.model_validate(r) for r in rows],
        count=owned_repo.count_rows(ctx, FocusSession, *where),
    )


@router.get("/current", response_model=SessionDetail | None, dependencies=READ)
def current(ctx: CtxDep) -> Any:
    """The session running now (or waiting between phases), or null."""
    return svc.current(ctx)


# ---------------------------------------------------------------- timer


@router.post("/sessions", response_model=SessionDetail, dependencies=WRITE)
def start(ctx: CtxDep, body: StartIn) -> Any:
    """Start a session now (one already running ends first)."""
    return svc.detail(ctx, svc.start(ctx, body=body))


@router.post("/current/pause", response_model=SessionDetail, dependencies=WRITE)
def pause(ctx: CtxDep) -> Any:
    return svc.detail(ctx, svc.pause(ctx))


@router.post("/current/resume", response_model=SessionDetail, dependencies=WRITE)
def resume(ctx: CtxDep) -> Any:
    return svc.detail(ctx, svc.resume(ctx))


@router.post("/current/next", response_model=SessionDetail, dependencies=WRITE)
def start_next(ctx: CtxDep) -> Any:
    """Begin the break or the next set the timer is waiting on."""
    return svc.detail(ctx, svc.start_next(ctx))


@router.post("/current/skip-break", response_model=SessionDetail, dependencies=WRITE)
def skip_break(ctx: CtxDep) -> Any:
    return svc.detail(ctx, svc.skip_break(ctx))


@router.post("/current/extend", response_model=SessionDetail, dependencies=WRITE)
def extend(ctx: CtxDep, body: ExtendIn) -> Any:
    return svc.detail(ctx, svc.extend(ctx, sec=body.sec))


@router.post("/current/switch", response_model=SessionDetail, dependencies=WRITE)
def switch(ctx: CtxDep, body: SwitchIn) -> Any:
    """Work on another item (or none) from now on."""
    return svc.detail(ctx, svc.switch(ctx, item=body.item))


@router.post("/current/stop", response_model=SessionDetail, dependencies=WRITE)
def stop(ctx: CtxDep, body: StopIn) -> Any:
    """End the session: keep it, or abandon it (``abandon``: counts nowhere)."""
    return svc.detail(ctx, svc.stop(ctx, abandon=body.abandon))


@router.get("/sessions/{session_id}", response_model=SessionDetail, dependencies=READ)
def get_session(ctx: CtxDep, session_id: uuid.UUID) -> Any:
    return svc.detail(ctx, svc.require_session(ctx, session_id))


@router.delete("/sessions/{session_id}", response_model=Message, dependencies=WRITE)
def delete_session(ctx: CtxDep, session_id: uuid.UUID) -> Any:
    svc.delete_session(ctx, session_id=session_id)
    return Message(message="Focus session deleted")
