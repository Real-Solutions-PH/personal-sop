"""REST routes of the companion (Sol): ask (JSON or SSE), the conversation,
trackers, memories, rename, and the data behind the chart and insights
blocks."""

import uuid
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Query
from fastapi.responses import StreamingResponse

from app.modules.capture import public as capture
from app.modules.companion import services
from app.modules.companion.schema import (
    AskIn,
    AskOut,
    CompanionState,
    InsightsOut,
    MemoryIn,
    MemoryPublic,
    MessagePublic,
    MessagesPublic,
    Metric,
    RenameIn,
    SeriesOut,
    TrackerIn,
    TrackerPublic,
)
from app.modules.iam.deps import require_permission
from app.shared.context import Ctx, CtxDep
from app.shared.pagination import PaginationDep
from app.shared.rate_limit import rate_limited
from app.shared.schema import Message

router = APIRouter(prefix="/companion", tags=["companion"])

READ = [Depends(require_permission("companion:read"))]
WRITE = [rate_limited("companion"), Depends(require_permission("companion:write"))]
SSE_HEADERS = {"Cache-Control": "no-cache", "X-Accel-Buffering": "no"}


def _state(ctx: Ctx) -> CompanionState:
    row = services.companion_row(ctx)
    ctx.commit()
    return CompanionState(
        name=row.name,
        trackers=[TrackerPublic.model_validate(t) for t in services.trackers(ctx)],
        memories=[MemoryPublic.model_validate(m) for m in services.memories(ctx)],
    )


@router.get("/", response_model=CompanionState, dependencies=READ)
def get_state(ctx: CtxDep) -> Any:
    """Sol's name, trackers and memories."""
    return _state(ctx)


@router.patch("/", response_model=CompanionState, dependencies=WRITE)
def rename(ctx: CtxDep, data: RenameIn) -> Any:
    """Rename the companion (blank resets to "Sol")."""
    services.rename(ctx, name=data.name)
    return _state(ctx)


@router.post("/ask", response_model=AskOut, dependencies=WRITE)
def ask(ctx: CtxDep, data: AskIn) -> Any:
    """Ask Sol. A replayed message id returns the reply it already got."""
    return services.ask(ctx, text=data.text, message_id=data.id)


@router.post(
    "/ask/stream",
    dependencies=WRITE,
    response_class=StreamingResponse,
    responses={200: {"content": {"text/event-stream": {}}}},
)
def ask_stream(ctx: CtxDep, data: AskIn) -> StreamingResponse:
    """Ask Sol over SSE: ``message`` (the stored question), ``text.delta``,
    ``block``, ``capture`` / the capture frames for a log, ``done`` (the
    whole answer) and ``error``. Validation happens before the stream."""

    def work(emit: Any) -> None:
        out = services.ask(ctx, text=data.text, message_id=data.id, emit=emit)
        emit("done", out.model_dump(mode="json"))

    return StreamingResponse(
        capture.stream_work(work, name="companion-ask"),
        media_type="text/event-stream",
        headers=SSE_HEADERS,
    )


@router.get("/messages", response_model=MessagesPublic, dependencies=READ)
def list_messages(ctx: CtxDep, page: PaginationDep) -> Any:
    rows, count = services.messages(ctx, skip=page.skip, limit=page.limit)
    return MessagesPublic(
        data=[MessagePublic.model_validate(m) for m in rows], count=count
    )


@router.delete("/messages", response_model=Message, dependencies=WRITE)
def clear_conversation(ctx: CtxDep) -> Any:
    n = services.clear_conversation(ctx)
    return Message(message=f"Cleared {n} messages")


@router.put("/trackers/{metric}", response_model=TrackerPublic, dependencies=WRITE)
def upsert_tracker(ctx: CtxDep, metric: Metric, data: TrackerIn) -> Any:
    """Track a metric (one tracker per metric: a second call updates it)."""
    return services.upsert_tracker(ctx, metric=metric, data=data)


@router.delete("/trackers/{tracker_id}", status_code=204, dependencies=WRITE)
def remove_tracker(ctx: CtxDep, tracker_id: uuid.UUID) -> None:
    services.remove_tracker(ctx, tracker_id=tracker_id)


@router.post(
    "/memories", response_model=MemoryPublic, status_code=201, dependencies=WRITE
)
def remember(ctx: CtxDep, data: MemoryIn) -> Any:
    return services.remember(ctx, text=data.text, memory_id=data.id)


@router.delete("/memories/{memory_id}", status_code=204, dependencies=WRITE)
def forget(ctx: CtxDep, memory_id: uuid.UUID) -> None:
    services.forget(ctx, memory_id=memory_id)


@router.get("/series/{metric}", response_model=SeriesOut, dependencies=READ)
def series(
    ctx: CtxDep, metric: Metric, days: Annotated[int, Query(ge=7, le=365)] = 30
) -> Any:
    """Chart block data (``stats.public.series``)."""
    return services.series(ctx, metric=metric, days=days)


@router.get("/insights", response_model=InsightsOut, dependencies=READ)
def insights(ctx: CtxDep) -> Any:
    """Insights block data (``stats.public.overview``)."""
    return InsightsOut(data=services.insights(ctx))
