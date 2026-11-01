"""REST routes of the companion (Fern by default): ask (JSON or SSE), the conversation,
trackers, memories, rename, and the data behind the chart and insights
blocks."""

import logging
import uuid
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Header, HTTPException, Query
from fastapi.responses import Response, StreamingResponse

from app.modules.companion import feedback, gate, memory, notify, runs, services, turn
from app.modules.companion.schema import (
    AskIn,
    AskOut,
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
from app.modules.profile import public as profile
from app.shared.context import Ctx, CtxDep, make_ctx
from app.shared.events import publish
from app.shared.pagination import PaginationDep
from app.shared.rate_limit import guarded, rate_limited
from app.shared.schema import Message
from app.shared.tenant_session import get_tenant_scoped_session

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
    blocks (``block``) and a router capture (``capture``), then
    ``RUN_FINISHED`` with the whole answer, or ``RUN_ERROR``. While the
    model reasons, ``REASONING_*`` events carry its thinking as it is
    written. Validation happens before the stream opens.

    The turn runs on its own (``runs``): dropping this stream never stops
    it, every frame carries an ``id`` to resume from, and sending the same
    question ``id`` again reads the reply already running."""
    run_id = str(data.id or uuid.uuid4())
    thread = str(data.thread_id or "latest")
    user = ctx.user
    uid = ctx.user_id

    def work(sink: turn.Sink) -> None:
        # The turn owns its database session and outlives this request: the
        # phone drops the stream when the app leaves the chat or goes to the
        # background, and the reply still finishes and is stored.
        sessions = get_tenant_scoped_session(user)
        own = make_ctx(next(sessions), user)
        try:
            _turn(own, sink)
        finally:
            sessions.close()

    def _turn(ctx: Ctx, sink: turn.Sink) -> None:
        stream = turn.TurnStream(
            ctx,
            thread_id=f"companion:{ctx.user_id}",
            run_id=run_id,
            sink=sink,
            stop_check=lambda: gate.stop_requested(ctx.user_id, run_id),
        )
        stream.started()
        # One reply at a time in a chat: a message sent while Fern is still
        # answering waits here ("queued"), then reads the finished reply.
        # While it runs, an app that lost the stream reads "running".
        try:
            with (
                gate.running(ctx.user_id, run_id),
                gate.turn_slot(
                    ctx.user_id,
                    thread,
                    run_id,
                    on_wait=lambda ahead: stream.custom("queued", {"behind": ahead}),
                ),
            ):
                out = services.ask(
                    ctx,
                    text=data.text,
                    message_id=data.id,
                    stream=stream,
                    media_ids=data.media_ids,
                    thread_id=data.thread_id,
                )
        except gate.Busy:
            stream.failed("busy", "Still answering your last message. Try again.")
            return
        stream.finished(out.model_dump(mode="json"))
        # Whether or not the phone still holds the stream: one in the app
        # fetches the reply at once instead of at its next sync.
        sol = next((m for m in out.messages if m.role == "sol"), None)
        publish(
            ctx.user_id,
            "companion.reply",
            {
                "thread_id": str(data.thread_id) if data.thread_id else None,
                # The question's id, which the app knows the reply by.
                "message_id": run_id,
                "reply_id": str(sol.id) if sol else None,
            },
        )
        # A person who left the app (the phone dropped this stream) hears
        # that the reply is ready; one still in the app sees it arrive.
        notify.reply_pushed(ctx, out)
        # The reply is out: what the turn teaches is learned now. A failure
        # here is logged and never reaches the finished reply.
        try:
            me = next((m for m in out.messages if m.role == "me"), None)
            if me is not None:
                _after_reply(ctx, data.text, me.id, stream, data.thread_id)
        except Exception as exc:  # noqa: BLE001 - after the reply, best effort
            ctx.session.rollback()
            log.warning("companion learn failed: %s", type(exc).__name__)

    # A resend of the same question (the app retrying after a dropped
    # connection) reads the reply already being written.
    runs.start(
        uid, run_id, work, on_heartbeat=lambda: gate.refresh_run(uid, run_id, thread)
    )
    # The stream needs nothing from the request's session: hand its
    # connection back now, not when a reply minutes long ends.
    release_connection(ctx.session)
    return StreamingResponse(
        runs.tail(uid, run_id, last_event_id),
        media_type="text/event-stream",
        headers=SSE_HEADERS,
    )


def _after_reply(
    ctx: Ctx,
    text: str,
    me_id: uuid.UUID,
    stream: turn.TurnStream,
    thread_id: uuid.UUID | None,
) -> None:
    """Learning that waits until the reply is out (none of it delays a word):

    1. the message's pushback on the reply before it, and cards the person
       undid, become feedback signals (``feedback``);
    2. lasting facts and preferences in the message are kept, also on a
       turn that logged something (``services.learn``);
    3. waiting thumbs-down notes are learned from, for the person and, de-
       identified, for every Fern (``feedback.digest``);
    4. memories still without an embedding are embedded for recall, and
       older messages are folded into the chat's summary.
    """
    signal = feedback.record_turn_signal(ctx, me_id, text)
    feedback.record_undos(ctx, me_id)
    services.learn(
        ctx,
        text,
        # A memory saved this turn (asked for, or by the reply) has used
        # the message already; a write (a task, a meal) has not: a habit
        # said while logging is still worth keeping.
        already=any(s.ok and s.name == "remember_fact" for s in stream.steps),
        wrote=any(s.ok and s.name in services.WRITE_TOOLS for s in stream.steps),
        follows=signal[1].text if signal else None,
        pushback=signal is not None,
    )
    mems = " ".join(m.text for m in memory.live(ctx))
    feedback.digest(
        ctx,
        private=" ".join(
            [
                ctx.user.full_name or "",
                ctx.user.email,
                profile.get_profile(ctx).name or "",
                mems,
                text,
            ]
        ),
        learn=lambda words, reply: services.learn(
            ctx, words, already=False, follows=reply, pushback=True
        ),
    )
    memory.backfill(ctx, limit=20)
    ctx.commit()
    services.summarise_later(ctx, thread_id)


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
    if not runs.exists(ctx.user_id, str(message_id)):
        raise HTTPException(status_code=404, detail="Reply not found")
    release_connection(ctx.session)
    return StreamingResponse(
        runs.tail(ctx.user_id, str(message_id), last_event_id),
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
    stored, ``running`` while its turn runs, else ``failed``. 404 when no
    such question of the caller's exists or runs."""
    done = services.stored_reply(ctx, message_id)
    if done is not None:
        return done
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


@router.get("/insights", response_model=InsightsOut, dependencies=READ)
def insights(ctx: CtxDep) -> Any:
    """Insights block data (``stats.public.overview``)."""
    return InsightsOut(data=services.insights(ctx))
