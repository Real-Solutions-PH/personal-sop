"""REST routes of the companion (Fern by default): ask (JSON or SSE), the conversation,
trackers, memories, rename, and the data behind the chart and insights
blocks."""

import logging
import uuid
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Query
from fastapi.responses import Response, StreamingResponse

from app.modules.companion import services, turn
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
from app.shared.context import Ctx, CtxDep, make_ctx
from app.shared.pagination import PaginationDep
from app.shared.rate_limit import rate_limited
from app.shared.schema import Message
from app.shared.tenant_session import get_tenant_scoped_session

log = logging.getLogger(__name__)
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
    """The companion's name, trackers and memories."""
    return _state(ctx)


@router.patch("/", response_model=CompanionState, dependencies=WRITE)
def rename(ctx: CtxDep, data: RenameIn) -> Any:
    """Rename the companion (blank resets to the default, Fern)."""
    services.rename(ctx, name=data.name)
    return _state(ctx)


@router.post(
    "/messages/{message_id}/speech",
    dependencies=WRITE,
    response_class=Response,
    responses={200: {"content": {"audio/mpeg": {}}}},
)
def speak(ctx: CtxDep, message_id: uuid.UUID) -> Response:
    """One of Fern's replies read aloud, as MP3 (Deepgram's voice)."""
    return Response(
        content=services.speak_message(ctx, message_id), media_type="audio/mpeg"
    )


@router.post("/ask", response_model=AskOut, dependencies=WRITE)
def ask(ctx: CtxDep, data: AskIn) -> Any:
    """Ask the companion. A replayed message id returns the reply it already got."""
    return services.ask(
        ctx,
        text=data.text,
        message_id=data.id,
        media_ids=data.media_ids,
        thread_id=data.thread_id,
    )


@router.post(
    "/ask/stream",
    dependencies=WRITE,
    response_class=StreamingResponse,
    responses={200: {"content": {"text/event-stream": {}}}},
)
def ask_stream(ctx: CtxDep, data: AskIn) -> StreamingResponse:
    """Ask the companion; the turn streams as AG-UI events (ADR-0015):
    ``RUN_STARTED``, a ``STEP_STARTED``/``STEP_FINISHED`` per model call and
    tool, ``TEXT_MESSAGE_*`` for the reply, ``TOOL_CALL_*`` per tool with a
    one-line outcome in ``TOOL_CALL_RESULT``, ``CUSTOM`` events for the
    stored question (``message``), cards (``card``, ``ask``, ``info``),
    blocks (``block``) and a router capture (``capture``), then
    ``RUN_FINISHED`` with the whole answer, or ``RUN_ERROR``. Validation
    happens before the stream opens."""
    run_id = str(data.id or uuid.uuid4())
    user = ctx.user

    def work(sink: turn.Sink) -> None:
        # The turn owns its database session. The request's session closes
        # when the phone drops the connection (the app leaves the chat or
        # goes to the background); a reply still being written on it then
        # failed half-saved. On its own session the reply always finishes
        # and is stored, and the app picks it up on its next sync.
        sessions = get_tenant_scoped_session(user)
        own = make_ctx(next(sessions), user)
        try:
            _turn(own, sink)
        finally:
            sessions.close()

    def _turn(ctx: Ctx, sink: turn.Sink) -> None:
        stream = turn.TurnStream(
            ctx, thread_id=f"companion:{ctx.user_id}", run_id=run_id, sink=sink
        )
        stream.started()
        out = services.ask(
            ctx,
            text=data.text,
            message_id=data.id,
            stream=stream,
            media_ids=data.media_ids,
            thread_id=data.thread_id,
        )
        stream.finished(out.model_dump(mode="json"))
        # The reply is out; what the message says about them that will last
        # is kept now, unless this turn already saved a memory. A failure
        # here is logged and never reaches the finished reply.
        try:
            services.learn(
                ctx,
                data.text,
                # A turn that saved a memory, or recorded what the message
                # asked for (a task, a meal), has used it already.
                already=any(
                    s.ok
                    and (s.name == "remember_fact" or s.name in services.WRITE_TOOLS)
                    for s in stream.steps
                ),
            )
        except Exception as exc:  # noqa: BLE001 - after the reply, best effort
            ctx.session.rollback()
            log.warning("companion learn failed: %s", type(exc).__name__)

    return StreamingResponse(
        turn.stream_events(work),
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
