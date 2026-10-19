"""REST routes of the capture module: one endpoint per screen action
(CAP-01 … CAP-19). Static paths are declared before ``/{capture_id}``."""

import uuid
from collections.abc import Iterator
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Query, Response
from fastapi.responses import StreamingResponse

from app.modules.ai_providers import public as ai
from app.modules.capture import cards as C
from app.modules.capture import engine, journal
from app.modules.capture.models import Capture
from app.modules.capture.schema import (
    AISettingsPublic,
    AISettingsUpdate,
    AnswerIn,
    CaptureDetail,
    CaptureIn,
    CapturesPublic,
    CardPublic,
    Count,
    PayloadIn,
    QuickAddIn,
    RerunIn,
    dump_payload,
)
from app.modules.iam.deps import require_permission
from app.shared.context import Ctx, CtxDep
from app.shared.pagination import PaginationDep
from app.shared.rate_limit import rate_limited

router = APIRouter(prefix="/capture", tags=["capture"])

READ = [Depends(require_permission("capture:read"))]
WRITE = [rate_limited("capture"), Depends(require_permission("capture:write"))]
SSE_HEADERS = {"Cache-Control": "no-cache", "X-Accel-Buffering": "no"}


def _detail(ctx: Ctx, cap: Capture) -> CaptureDetail:
    return engine.detail(ctx, cap)


def _card(ctx: Ctx, card: Any) -> CardPublic:
    return engine.card_public(ctx, card)


# ---------------------------------------------------------------- settings


def _settings_out(ctx: Ctx) -> AISettingsPublic:
    row = journal.settings_row(ctx)
    b = ai.budget(ctx)
    out = AISettingsPublic.model_validate(row)
    out.spend_minor, out.calls = b.spend_minor, b.calls
    return out


@router.get("/settings", response_model=AISettingsPublic, dependencies=READ)
def get_settings(ctx: CtxDep) -> Any:
    """CAP-17 AI settings, seeded with the prototype's auto-save rules."""
    journal.get_settings(ctx)
    return _settings_out(ctx)


@router.patch("/settings", response_model=AISettingsPublic, dependencies=WRITE)
def update_settings(ctx: CtxDep, data: AISettingsUpdate) -> Any:
    journal.update_settings(ctx, data=data)
    return _settings_out(ctx)


# ---------------------------------------------------------------- thread


@router.get("/", response_model=CapturesPublic, dependencies=READ)
def thread(
    ctx: CtxDep,
    page: PaginationDep,
    status: Annotated[str | None, Query(max_length=12)] = None,
    source: Annotated[str | None, Query(max_length=10)] = None,
    q: Annotated[str | None, Query(max_length=100)] = None,
) -> Any:
    """CAP-01 thread and CAP-12 history (newest first, filterable)."""
    rows, count = engine.thread(
        ctx, status=status, source=source, q=q, skip=page.skip, limit=page.limit
    )
    return CapturesPublic(data=[_detail(ctx, c) for c in rows], count=count)


@router.get("/queue", response_model=CapturesPublic, dependencies=READ)
def pending(ctx: CtxDep, page: PaginationDep) -> Any:
    """CAP-14 pending sheet: queued and failed captures, oldest first."""
    from sqlmodel import col

    from app.shared import owned_repo

    where = [col(Capture.status).in_(("queued", "failed", "processing"))]
    rows = owned_repo.list_rows(
        ctx, Capture, *where, order_by=[col(Capture.at)], skip=page.skip, limit=page.limit
    )
    return CapturesPublic(
        data=[_detail(ctx, c) for c in rows], count=owned_repo.count_rows(ctx, Capture, *where)
    )


@router.post("/", response_model=CaptureDetail, dependencies=WRITE)
def submit(ctx: CtxDep, data: CaptureIn, response: Response) -> Any:
    """F-CAP-01: store and read a capture; a replayed ``client_uuid``
    returns the capture it already made (200 instead of 201)."""
    out = engine.submit_and_keep(ctx, data)
    if not out.created:
        return _detail(ctx, out.capture)
    response.status_code = 201
    if data.queue_only:
        ctx.commit()
        return _detail(ctx, out.capture)
    return _detail(ctx, engine.process(ctx, out.capture))


def _replay_frames(ctx: Ctx, cap: Capture) -> Iterator[str]:
    d = _detail(ctx, cap)
    yield engine.sse("capture", d.model_dump(mode="json", exclude={"cards", "replies", "attachments"}))
    yield engine.sse("done", d.model_dump(mode="json"))


@router.post(
    "/stream",
    dependencies=WRITE,
    response_class=StreamingResponse,
    responses={200: {"content": {"text/event-stream": {}}}},
)
def submit_stream(ctx: CtxDep, data: CaptureIn) -> StreamingResponse:
    """F-CAP-01 streamed: SSE frames ``capture``, ``text.delta``, ``card``,
    ``ask``, ``info``, ``done``, ``error``. Validation, the AI switch, the
    spend cap and voice transcription are resolved before the stream opens:
    a refusal is an HTTP error (the capture is kept as ``failed``)."""
    out = engine.submit_and_keep(ctx, data)
    if not out.created or data.queue_only:
        ctx.commit()
        return StreamingResponse(
            _replay_frames(ctx, out.capture), media_type="text/event-stream", headers=SSE_HEADERS
        )
    plan = engine.preflight(ctx, out.capture)
    return StreamingResponse(
        engine.stream(ctx, out.capture, plan), media_type="text/event-stream", headers=SSE_HEADERS
    )


@router.post("/quick-add", response_model=CaptureDetail, dependencies=WRITE)
def quick_add(ctx: CtxDep, data: QuickAddIn) -> Any:
    """CAP-10: a hand-entered record, saved at once with Undo."""
    cap = engine.quick_add(
        ctx, client_uuid=data.client_uuid, text=data.text, payload=dump_payload(data.payload)
    )
    return _detail(ctx, cap)


@router.post("/clear", response_model=Count, dependencies=WRITE)
def clear_thread(ctx: CtxDep) -> Any:
    """CAP-17 clear thread: captures leave the thread; records stay."""
    return Count(count=engine.clear_thread(ctx))


@router.post("/retention/run", response_model=Count, dependencies=WRITE)
def run_retention(ctx: CtxDep) -> Any:
    """Remove captures older than ``retention_days`` (the job body)."""
    return Count(count=engine.purge_expired(ctx))


@router.post("/resume-stuck", response_model=Count, dependencies=WRITE)
def resume_stuck(ctx: CtxDep) -> Any:
    """Re-read every capture stuck in ``processing`` (app open)."""
    return Count(count=engine.resume_stuck(ctx))


# ---------------------------------------------------------------- cards


@router.get("/cards/{card_id}", response_model=CardPublic, dependencies=READ)
def get_card(ctx: CtxDep, card_id: uuid.UUID) -> Any:
    return _card(ctx, C.require_card(ctx, card_id))


@router.post("/cards/{card_id}/confirm", response_model=CardPublic, dependencies=WRITE)
def confirm_card(ctx: CtxDep, card_id: uuid.UUID) -> Any:
    """CAP-05 Confirm (a replay on a saved card is a no-op)."""
    return _card(ctx, C.confirm(ctx, card_id=card_id))


@router.post("/cards/{card_id}/discard", response_model=CardPublic, dependencies=WRITE)
def discard_card(ctx: CtxDep, card_id: uuid.UUID) -> Any:
    return _card(ctx, C.discard(ctx, card_id=card_id))


@router.post("/cards/{card_id}/undo", response_model=CardPublic, dependencies=WRITE)
def undo_card(ctx: CtxDep, card_id: uuid.UUID) -> Any:
    """CAP-05/08 Undo: removes exactly the rows the card wrote."""
    return _card(ctx, C.undo(ctx, card_id=card_id))


@router.post("/cards/{card_id}/redo", response_model=CardPublic, dependencies=WRITE)
def redo_card(ctx: CtxDep, card_id: uuid.UUID) -> Any:
    return _card(ctx, C.redo(ctx, card_id=card_id))


@router.patch("/cards/{card_id}", response_model=CardPublic, dependencies=WRITE)
def edit_card(ctx: CtxDep, card_id: uuid.UUID, data: PayloadIn) -> Any:
    """CAP-06 edit sheet: a saved card is rewritten in its module."""
    return _card(ctx, C.edit(ctx, card_id=card_id, payload=dump_payload(data.payload)))


@router.post("/cards/{card_id}/answer", response_model=CaptureDetail, dependencies=WRITE)
def answer_card(ctx: CtxDep, card_id: uuid.UUID, data: AnswerIn) -> Any:
    """CAP-07 follow-up chip or free reply. Returns the whole capture (a
    photo's "what is this?" answer replaces the card with new ones)."""
    out = C.answer(ctx, card_id=card_id, value=data.value)
    return _detail(ctx, C.require_capture(ctx, out.card.capture_id))


@router.post("/cards/{card_id}/skip", response_model=CardPublic, dependencies=WRITE)
def skip_ask(ctx: CtxDep, card_id: uuid.UUID) -> Any:
    """CAP-07 Skip: keeps the card waiting in History."""
    return _card(ctx, C.skip(ctx, card_id=card_id))


# ---------------------------------------------------------------- one capture


@router.get("/{capture_id}", response_model=CaptureDetail, dependencies=READ)
def get_capture(ctx: CtxDep, capture_id: uuid.UUID) -> Any:
    """CAP-13 capture detail: input, cards with their write log, replies."""
    return _detail(ctx, C.require_capture(ctx, capture_id))


@router.post("/{capture_id}/retry", response_model=CaptureDetail, dependencies=WRITE)
def retry(ctx: CtxDep, capture_id: uuid.UUID) -> Any:
    """CAP-14/19 Retry (also "process now" for a queued capture)."""
    return _detail(ctx, engine.retry(ctx, capture_id=capture_id))


@router.post("/{capture_id}/rerun", response_model=CaptureDetail, dependencies=WRITE)
def rerun(ctx: CtxDep, capture_id: uuid.UUID, data: RerunIn) -> Any:
    """CAP-13 Re-run AI (optionally on an edited text or transcript)."""
    return _detail(ctx, engine.rerun(ctx, capture_id=capture_id, text=data.text))


@router.post("/{capture_id}/resume", response_model=CaptureDetail, dependencies=WRITE)
def resume(ctx: CtxDep, capture_id: uuid.UUID) -> Any:
    return _detail(ctx, engine.resume(ctx, capture_id=capture_id))


@router.post(
    "/{capture_id}/confirm-all", response_model=list[CardPublic], dependencies=WRITE
)
def confirm_all(ctx: CtxDep, capture_id: uuid.UUID) -> Any:
    """F-CAP-08 Confirm all (two or more proposed cards)."""
    return [_card(ctx, c) for c in C.confirm_all(ctx, capture_id=capture_id)]


@router.delete("/{capture_id}", status_code=204, dependencies=WRITE)
def delete_capture(ctx: CtxDep, capture_id: uuid.UUID) -> None:
    """CAP-13/14 Delete capture (its records stay in their modules)."""
    engine.delete(ctx, capture_id=capture_id)
