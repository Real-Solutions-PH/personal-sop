"""REST routes of the companion (Fern by default): ask (JSON or SSE), the conversation,
trackers, memories, rename, and the data behind the chart and insights
blocks."""

import logging
import uuid
from collections.abc import Awaitable, Callable
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Header, HTTPException, Query
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import Response, StreamingResponse

from app.modules.ai_providers import public as ai
from app.modules.companion import (
    feedback,
    gate,
    queue,
    review,
    runs,
    services,
)
from app.modules.companion.schema import (
    AllowanceOut,
    AskIn,
    AskOut,
    AskQueued,
    CompanionState,
    FeedbackIn,
    FeedbackPublic,
    FernRuleDecision,
    FernRulePublic,
    InsightsOut,
    MemoryIn,
    MemoryPublic,
    MessagePublic,
    MessagesPublic,
    Metric,
    RenameIn,
    ReplyOut,
    ReviewIn,
    ReviewOut,
    RuleStatus,
    SeriesOut,
    TrackerIn,
    TrackerPublic,
)
from app.modules.iam.deps import (
    get_current_active_superuser,
    release_connection,
    require_permission,
)
from app.shared.context import Ctx, CtxDep
from app.shared.pagination import PaginationDep
from app.shared.rate_limit import guarded, rate_limited
from app.shared.schema import Message

log = logging.getLogger(__name__)
router = APIRouter(prefix="/companion", tags=["companion"])

READ = [Depends(require_permission("companion:read"))]
WRITE = [rate_limited("companion"), Depends(require_permission("companion:write"))]
# Model-backed (an LLM turn or Deepgram speech): per-user and per-address budget.
AI = [*WRITE, guarded("ai", "companion")]
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
    dependencies=AI,
    response_class=Response,
    responses={200: {"content": {"audio/mpeg": {}}}},
)
def speak(ctx: CtxDep, message_id: uuid.UUID) -> Response:
    """One of Fern's replies read aloud, as MP3 (Deepgram's voice)."""
    return Response(
        content=services.speak_message(ctx, message_id), media_type="audio/mpeg"
    )


@router.get("/allowance", response_model=AllowanceOut, dependencies=READ)
def get_allowance(ctx: CtxDep) -> Any:
    """Today's Fern messages: the limit, how many are used and when the
    count resets (the free allowance, or Plus's fair-use hard stops)."""
    a = ai.allowance(ctx)
    return AllowanceOut(
        applies=services.allowance_applies(ctx),
        plan=a.plan,
        limit=a.limit,
        used=a.used,
        remaining=a.remaining,
        resets_at=a.resets_at,
        month_stopped=a.month_stopped,
        month_resets_at=a.month_resets_at,
    )


@router.post("/ask", response_model=AskOut, dependencies=AI)
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
    dependencies=AI,
    response_class=StreamingResponse,
    responses={200: {"content": {"text/event-stream": {}}}},
)
def ask_stream(
    ctx: CtxDep,
    data: AskIn,
    last_event_id: str | None = Header(default=None, alias="Last-Event-ID"),
) -> StreamingResponse:
    """Ask the companion; the turn streams as AG-UI events (ADR-0015):
    ``RUN_STARTED``, a ``STEP_STARTED``/``STEP_FINISHED`` per model call and
    tool, ``TEXT_MESSAGE_*`` for the reply, ``TOOL_CALL_*`` per tool with a
    one-line outcome in ``TOOL_CALL_RESULT``, ``CUSTOM`` events for the
    stored question (``message``), cards (``card``, ``ask``, ``info``),
    blocks (``block``), a router capture (``capture``), the synced rows a
    tool just wrote, committed (``changes``, right after its result), then
    ``RUN_FINISHED`` with the whole answer, or ``RUN_ERROR``. While the
    model reasons, ``REASONING_*`` events carry its thinking as it is
    written. Validation happens before the stream opens.

    The turn runs on its own (``runs``): dropping this stream never stops
    it, every frame carries an ``id`` to resume from, and sending the same
    question ``id`` again reads the reply already running."""
    # A message past today's allowance is refused before the stream opens,
    # as a 402 the app reads (``fern_daily_allowance_reached``).
    services.check_allowance(ctx, data.id)
    data = data.model_copy(update={"id": data.id or uuid.uuid4()})
    assert data.id is not None
    # Kept on the server first: the turn runs from the queue whether or not
    # this stream stays open, and a resend of the same id reads it.
    row = queue.enqueue(ctx, data, replay=True)
    uid, ask_id = ctx.user_id, row.id
    release_connection(ctx.session)
    queue.kick(uid)
    return StreamingResponse(
        runs.tail(uid, str(ask_id), last_event_id, pending=_pending(uid, ask_id)),
        media_type="text/event-stream",
        headers=SSE_HEADERS,
    )


def _pending(uid: uuid.UUID, ask_id: uuid.UUID) -> Callable[[], Awaitable[bool]]:
    async def check() -> bool:
        return await run_in_threadpool(queue.pending, uid, ask_id)

    return check


# The general write limit, not the AI one: storing a message runs no model,
# and the queue runs one turn at a time per person (the allowance bounds
# how many). Under the AI limit a burst of queued messages handed over at
# once (20 a minute in production) was refused.
@router.post("/messages", response_model=AskQueued, status_code=202, dependencies=WRITE)
def send_message(ctx: CtxDep, data: AskIn) -> Any:
    """Hand a message to Fern: it is kept on the server and answered there,
    in order, one at a time, whether or not the app stays open (a push says
    when the reply is ready and the app is away). Idempotent by ``id``: a
    resend changes nothing, a resend of a failed message asks again (Retry).
    Follow the reply live with ``GET /messages/{id}/events``. 402 past the
    allowance; 409 when the id is someone else's."""
    services.check_allowance(ctx, data.id)
    data = data.model_copy(update={"id": data.id or uuid.uuid4()})
    row = queue.enqueue(ctx, data)
    out = AskQueued(id=row.id, status=row.status)  # type: ignore[arg-type]
    if row.status == "queued":
        queue.kick(ctx.user_id)
    return out


@router.put(
    "/messages/{message_id}/feedback",
    response_model=FeedbackPublic | None,
    dependencies=WRITE,
)
def rate_reply(ctx: CtxDep, message_id: uuid.UUID, data: FeedbackIn) -> Any:
    """Thumbs up or down on one Fern reply (``rating: null`` clears it). A
    thumbs-down may carry a reason chip and a short note; Fern learns from
    it after its next reply (``feedback.digest``)."""
    row = feedback.rate(
        ctx, message_id, rating=data.rating, reason=data.reason, note=data.note
    )
    return FeedbackPublic.model_validate(row) if row is not None else None


ADMIN = [Depends(get_current_active_superuser)]


@router.get("/fern-rules", response_model=list[FernRulePublic], dependencies=ADMIN)
def list_rules(ctx: CtxDep, status: RuleStatus | None = None) -> Any:
    """Every rule learned for all of Fern, most supported first (admins).
    Rules hold no personal data; only approved ones, or ones past the
    automatic threshold, shape answers."""
    return [
        FernRulePublic.model_validate(r) for r in feedback.rules(ctx=ctx, status=status)
    ]


@router.patch(
    "/fern-rules/{rule_id}", response_model=FernRulePublic, dependencies=ADMIN
)
def decide_rule(ctx: CtxDep, rule_id: uuid.UUID, data: FernRuleDecision) -> Any:
    """Approve, reject or re-open a shared rule, optionally rewording it."""
    return FernRulePublic.model_validate(
        feedback.decide(ctx, rule_id, data.status, data.text)
    )


@router.get(
    "/messages/{message_id}/events",
    dependencies=READ,
    response_class=StreamingResponse,
    responses={200: {"content": {"text/event-stream": {}}}},
)
def reply_events(
    ctx: CtxDep,
    message_id: uuid.UUID,
    last_event_id: str | None = Header(default=None, alias="Last-Event-ID"),
) -> StreamingResponse:
    """The reply to the question ``message_id`` as it is being written, for
    an app that comes back to the chat: every AG-UI event so far (or those
    after ``Last-Event-ID``), then each new one live, the same frames as
    ``/ask/stream``. 404 once the reply's events are no longer kept (about
    an hour after it ended); ``/messages/{id}/reply`` still has it."""
    if not runs.exists(ctx.user_id, str(message_id)) and not queue.pending(
        ctx.user_id, message_id
    ):
        raise HTTPException(status_code=404, detail="Reply not found")
    release_connection(ctx.session)
    return StreamingResponse(
        runs.tail(
            ctx.user_id,
            str(message_id),
            last_event_id,
            pending=_pending(ctx.user_id, message_id),
        ),
        media_type="text/event-stream",
        headers=SSE_HEADERS,
    )


@router.post("/messages/{message_id}/stop", status_code=204, dependencies=AI)
def stop_reply(ctx: CtxDep, message_id: uuid.UUID) -> Response:
    """Stop the reply to this message at its next step (the app's "Send
    now" for a message queued behind it). What the reply already did stays.
    Stopping a reply that has ended does nothing."""
    gate.request_stop(ctx.user_id, str(message_id))
    return Response(status_code=204)


@router.get("/messages/{message_id}/reply", response_model=ReplyOut, dependencies=READ)
def get_reply(ctx: CtxDep, message_id: uuid.UUID) -> Any:
    """Where the reply to the question ``message_id`` stands, for an app
    whose stream dropped: ``done`` with the stored messages once the reply is
    stored, ``queued`` while it waits on the server, ``running`` while its
    turn runs, else ``failed``. 404 when no
    such question of the caller's exists or runs."""
    done = services.stored_reply(ctx, message_id)
    if done is not None:
        return done
    row = queue.status(ctx, message_id)
    if row is not None and row.status in ("queued", "running", "failed"):
        return ReplyOut(status=row.status, error=row.error)  # type: ignore[arg-type]
    if gate.is_running(ctx.user_id, str(message_id)):
        return ReplyOut(status="running")
    if services.question_stored(ctx, message_id):
        return ReplyOut(status="failed")
    raise HTTPException(status_code=404, detail="Message not found")


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


@router.post("/review", response_model=ReviewOut, dependencies=WRITE)
def fern_review(ctx: CtxDep, data: ReviewIn) -> Any:
    """Fern's wins-first review of a range (the way back, or a week): at
    most two gaps, each with one tiny habit or task suggestion. Kept per
    range until its facts change. 503 ``review_failed`` when the provider
    fails; nothing is kept then."""
    return review.review(ctx, data)


@router.get("/insights", response_model=InsightsOut, dependencies=READ)
def insights(ctx: CtxDep) -> Any:
    """Insights block data (``stats.public.overview``)."""
    return InsightsOut(data=services.insights(ctx))
