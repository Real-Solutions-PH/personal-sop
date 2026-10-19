"""The capture pipeline (prototype ``engine.ts`` ``sendCapture`` /
``processCapture``): store the input, interpret it, reply with cards.

``submit`` is idempotent on ``client_uuid``: an offline replay returns the
capture already made and never interprets it twice.

Order of work, so a refusal is never a 200 with an empty stream:

1. validate the input and store the capture (the input is never lost);
2. :func:`preflight` — the AI kill switch and the spend cap
   (``ai_providers.public.check_budget``) and, for voice, the transcript.
   A refusal marks the capture ``failed`` with an error card, commits, and
   raises the HTTP error before any stream opens;
3. :func:`run` — interpretation. With a capture model it is the LangGraph
   agent (:mod:`agent`); without one the rules parser (:mod:`parse`) plus
   the "fallback" info card. Photos go through :mod:`photo`, statement
   files to finance's import.

``emit(event, data)`` receives the SSE frames as they happen: ``capture``,
``text.delta``, ``card``, ``ask``, ``info``, ``done`` and ``error``.
"""

import json
import queue
import threading
import uuid
from collections.abc import Callable, Iterator
from dataclasses import dataclass
from datetime import timedelta
from typing import Any

from fastapi import HTTPException
from sqlalchemy.exc import IntegrityError
from sqlmodel import col

from app.modules.ai_providers import public as ai
from app.modules.capture import agent, ports, qa, rules, seams
from app.modules.capture import cards as C
from app.modules.capture import photo as Ph
from app.modules.capture.journal import settings_row
from app.modules.capture.models import (
    Capture,
    CaptureAttachment,
    CardWriteLog,
    RecordCard,
    ReplyItem,
)
from app.modules.capture.parse import Draft, ParseCtx, RecordDraft, parse_capture
from app.modules.capture.schema import (
    CaptureDetail,
    CaptureIn,
    CapturePublic,
    CardPublic,
    ReplyPublic,
    WriteLogPublic,
)
from app.modules.media import public as media
from app.shared import owned_repo
from app.shared.context import Ctx
from app.shared.domain import conflict, domain_error, invalid

Emit = Callable[[str, dict[str, Any]], None]
STUCK_AFTER = timedelta(seconds=60)
FALLBACK_CARD = {
    "t": "info",
    "tone": "fallback",
    "title": "Read by the built-in rules",
    "body": "No AI model is set up for capture, so the built-in rules read this. "
    "Add a provider in AI settings for smarter reads.",
    "actions": [{"label": "AI settings", "do": "link", "href": "/capture/settings"}],
}
UNAVAILABLE_CARD = {
    "t": "info",
    "tone": "fallback",
    "title": "The AI didn't answer — the built-in rules read this",
    "body": "Your provider didn't respond. Retry later for an AI read.",
    "actions": [{"label": "Retry", "do": "retry"}],
}


def _noop(event: str, data: dict[str, Any]) -> None:
    del event, data


# ---------------------------------------------------------------- views


def card_public(ctx: Ctx, card: RecordCard) -> CardPublic:
    ctx.session.flush()
    ctx.session.refresh(card)
    out = CardPublic.model_validate(card)
    out.log = [WriteLogPublic.model_validate(x) for x in C.log_of(ctx, card.id)]
    return out


def detail(ctx: Ctx, cap: Capture) -> CaptureDetail:
    ctx.session.flush()
    ctx.session.refresh(cap)
    out = CaptureDetail.model_validate(cap)
    out.cards = [card_public(ctx, c) for c in C.cards_of(ctx, cap.id)]
    out.replies = [ReplyPublic.model_validate(r) for r in C.replies_of(ctx, cap.id)]
    from app.modules.capture.schema import AttachmentPublic

    out.attachments = [
        AttachmentPublic.model_validate(a)
        for a in owned_repo.list_rows(
            ctx, CaptureAttachment, col(CaptureAttachment.capture_id) == cap.id
        )
    ]
    return out


def emit_card(ctx: Ctx, emit: Emit, card: RecordCard) -> None:
    pub = card_public(ctx, card).model_dump(mode="json")
    emit("card", pub)
    if card.state == "needs_input" and card.ask:
        emit("ask", {"card_id": str(card.id), "ask": card.ask})


def emit_reply(
    ctx: Ctx, emit: Emit, cap: Capture, body: dict[str, Any], *, position: int
) -> ReplyItem:
    kind = "answer" if body.get("t") == "answer" else "info"
    row = C.new_reply(ctx, cap, kind, {**body, "t": kind}, position=position)
    _emit_reply_row(emit, row)
    return row


def _emit_reply_row(emit: Emit, row: ReplyItem) -> None:
    pub = ReplyPublic.model_validate(row).model_dump(mode="json")
    emit("card" if row.kind == "answer" else "info", pub)


# ---------------------------------------------------------------- submit


@dataclass
class Submitted:
    capture: Capture
    created: bool


def _attach(ctx: Ctx, cap: Capture, media_id: uuid.UUID, kind: str) -> None:
    kinds: tuple[media.MediaKind, ...] = {
        "image": ("image",),
        "audio": ("audio",),
        "file": ("file", "image"),
    }[kind]  # type: ignore[assignment]
    media.require_ready(ctx, media_id, kinds=kinds)
    owned_repo.insert(
        ctx,
        CaptureAttachment,
        {"capture_id": cap.id, "media_id": media_id, "kind": kind},
        row_id=uuid.uuid5(cap.id, f"attachment:{media_id}"),
    )


def submit(ctx: Ctx, data: CaptureIn) -> Submitted:
    """Store (or replay) a capture. Flushes; the caller processes/commits."""
    existing = owned_repo.find_one(
        ctx, Capture, col(Capture.client_uuid) == data.client_uuid, include_deleted=True
    )
    if existing is not None:
        return Submitted(existing, False)
    if data.source == "photo" and data.media_id is None:
        raise invalid("photo_required", "Attach the photo first")
    if data.source == "voice" and data.media_id is None and not (data.transcript or data.text):
        raise invalid("audio_required", "Attach the recording or its transcript")
    if data.source == "file" and data.media_id is None:
        raise invalid("file_required", "Attach the statement file first")
    if data.source in ("text", "quick_add", "connector") and not data.text.strip():
        raise invalid("text_required", "Type something to capture")
    hint = data.hint if data.hint in ("auto", "meal", "receipt", "label", "statement", "whiteboard") else None
    values: dict[str, Any] = {
        "client_uuid": data.client_uuid,
        "at": data.at or ctx.now,
        "source": data.source,
        "text": data.text.strip(),
        "transcript": data.transcript,
        "duration_sec": data.duration_sec,
        "hint": hint,
        "file_name": data.file_name,
        "status": "queued",
    }
    if data.source == "photo" and hint is None:
        values["hint"] = "auto"
    cap = owned_repo.insert(ctx, Capture, values, row_id=data.id)
    # Hints that are not photo hints ("journal", "expense", ...) steer the
    # parser for this run only; the column holds photo hints.
    ctx.session.info.setdefault("capture_hints", {})[cap.id] = data.hint
    if data.account_id is not None:
        ctx.session.info.setdefault("capture_accounts", {})[cap.id] = data.account_id
    if data.media_id is not None:
        kind = {"photo": "image", "voice": "audio", "file": "file"}.get(data.source)
        if kind is None:
            raise invalid("media_unexpected", "This kind of capture has no attachment")
        _attach(ctx, cap, data.media_id, kind)
    return Submitted(cap, True)


def submit_and_keep(ctx: Ctx, data: CaptureIn) -> Submitted:
    """``submit`` that turns a duplicate client id from another user (a
    primary-key clash this user cannot see) into a 409."""
    sp = ctx.session.begin_nested()
    try:
        out = submit(ctx, data)
        sp.commit()
    except IntegrityError:
        sp.rollback()
        raise conflict("id_conflict", "That id is already in use") from None
    return out


# ---------------------------------------------------------------- preflight


@dataclass
class Plan:
    resolved: ai.ResolvedModel | None
    hint: str | None
    account_id: uuid.UUID | None


def _fail(ctx: Ctx, cap: Capture, code: str, title: str, body: str) -> None:
    for r in C.replies_of(ctx, cap.id):
        owned_repo.soft_delete(ctx, r)
    cap.status = "failed"
    cap.error_code = code
    cap.reply_text = "I kept your message."
    ctx.session.add(cap)
    C.new_reply(
        ctx,
        cap,
        "info",
        {
            "t": "info",
            "tone": "error",
            "title": title,
            "body": body,
            "actions": [
                {"label": "Quick add", "do": "quickadd"},
                {"label": "Retry", "do": "retry"},
                {"label": "Save as journal", "do": "journal", "prompt": cap.text},
            ],
        },
        position=0,
    )
    ctx.session.flush()


def _model_purpose(cap: Capture) -> ai.Purpose:
    return "vision" if cap.source == "photo" else "capture"


def preflight(ctx: Ctx, cap: Capture) -> Plan:
    """Everything that can refuse, resolved before interpretation (and
    before an SSE stream opens). A refusal keeps the capture as ``failed``,
    commits it, and raises."""
    st = settings_row(ctx)
    resolved = ai.resolve_model(ctx, "capture")
    needs_model = (
        resolved is not None
        or (cap.source == "photo" and ai.resolve_model(ctx, "vision") is not None)
        or (cap.source == "voice" and not (cap.transcript or cap.text) and st.transcription == "server")
    )
    try:
        if not st.ai_enabled or needs_model:
            ai.check_budget(ctx)
    except HTTPException as exc:
        code = exc.detail["code"] if isinstance(exc.detail, dict) else "ai_refused"
        _fail(
            ctx,
            cap,
            code,
            "AI is off" if code == "ai_disabled" else "Spend cap reached",
            "Your input is saved. Log it by hand, or retry once AI is back.",
        )
        ctx.commit()
        raise domain_error(
            exc.status_code,
            code,
            exc.detail["message"] if isinstance(exc.detail, dict) else "AI refused",
            {"capture_id": str(cap.id)},
        ) from None
    if cap.source == "voice":
        _transcript(ctx, cap, st.transcription, st.language)
    hints = ctx.session.info.get("capture_hints", {})
    accounts = ctx.session.info.get("capture_accounts", {})
    return Plan(resolved=resolved, hint=hints.get(cap.id) or cap.hint, account_id=accounts.get(cap.id))


def _transcript(ctx: Ctx, cap: Capture, mode: str, language: str) -> None:
    if cap.transcript or cap.text:
        cap.transcript = cap.transcript or cap.text
        cap.text = cap.text or cap.transcript
        return
    def refuse(code: str, title: str) -> None:
        _fail(ctx, cap, code, title, "Your recording is saved. Type what you said, or retry.")
        ctx.commit()
        raise domain_error(422, code, title, {"capture_id": str(cap.id)})

    if mode == "browser":
        refuse("transcript_required", "Send the transcript with the recording")
    resolved = ai.resolve_model(ctx, "transcription")
    if resolved is None:
        refuse("transcription_unavailable", "No transcription model is set up")
        return
    att = owned_repo.find_one(
        ctx,
        CaptureAttachment,
        col(CaptureAttachment.capture_id) == cap.id,
        col(CaptureAttachment.kind) == "audio",
    )
    if att is None:
        refuse("audio_required", "Attach the recording")
        return
    m = media.require_ready(ctx, att.media_id, kinds=("audio",))
    audio = media.read_bytes(m, max_bytes=seams.AUDIO_MAX_BYTES)
    try:
        text = seams.transcribe(
            resolved,
            audio,
            filename=f"capture-{cap.id}",
            mime=m.mime,
            language="tl" if language == "en-tl" else "en",
        )
    except seams.SeamError as exc:
        ai.record_usage(ctx, resolved, input_tokens=0, output_tokens=0, ok=False)
        refuse(exc.code, "Couldn't transcribe the recording")
        return
    minutes = max(1, -(-(cap.duration_sec or 60) // 60))
    ai.record_usage(
        ctx,
        resolved,
        input_tokens=0,
        output_tokens=0,
        cost_minor=minutes * seams.TRANSCRIBE_CENTAVOS_PER_MIN,
    )
    if not text:
        refuse("transcript_empty", "I couldn't hear anything in that recording")
    cap.transcript = text
    cap.text = text
    ctx.session.add(cap)
    ctx.session.flush()


# ---------------------------------------------------------------- run


@dataclass
class Pos:
    n: int = 0

    def take(self) -> int:
        p = self.n
        self.n += 1
        return p


def photo_env(
    ctx: Ctx,
    cap: Capture,
    *,
    resolved: ai.ResolvedModel | None = None,
    emit: Emit = _noop,
    pos: Pos | None = None,
) -> Ph.PhotoEnv:
    world = ports.build_world(ctx, at=cap.at)
    st = settings_row(ctx)
    img = Ph.image_of(ctx, cap)
    vision = ai.resolve_model(ctx, "vision") if st.send_photos else None
    if vision is not None and not vision.supports_vision:
        vision = None
    made: list[int] = []
    p = pos or Pos()

    def text_path(text: str, hint: str) -> list[Draft]:
        if resolved is None:
            return Ph.rules_text_path(world)(text, hint)
        prefix = f"Text read from a {hint} photo:\n" if hint != "auto" else "Text read from a photo:\n"
        try:
            _, r = agent.run_capture_agent(
                ctx,
                cap,
                resolved,
                world=world,
                emit=emit,
                text=prefix + text,
                journal_in_qa=st.journal_in_qa,
                start=p.n,
            )
        except seams.SeamError:
            return Ph.rules_text_path(world)(text, hint)
        p.n = r.position
        made.extend(range(len(r.made)))
        return []

    env = Ph.PhotoEnv(
        world=world, image=(img[1], img[2]) if img else None, vision=vision, text_path=text_path
    )
    env.made = made  # type: ignore[attr-defined]
    return env


def _persist(ctx: Ctx, cap: Capture, drafts: list[Draft], emit: Emit, pos: Pos, *, actor: str = "ai") -> None:
    st = settings_row(ctx)
    built = C.add_drafts(
        ctx,
        cap,
        drafts,
        answer_fn=lambda q: qa.answer(ctx, q, journal_in_qa=st.journal_in_qa),
        start=pos.n,
        actor=actor,
    )
    pos.n += len(drafts)
    items: list[tuple[int, Any]] = [(c.position, c) for c in built.cards]
    items += [(r.position, r) for r in built.replies]
    for _, it in sorted(items, key=lambda x: x[0]):
        if isinstance(it, RecordCard):
            emit_card(ctx, emit, it)
        else:
            _emit_reply_row(emit, it)


def _interpret(ctx: Ctx, cap: Capture, plan: Plan, emit: Emit, pos: Pos) -> tuple[str, str | None]:
    """Returns (engine, the model's reply text if any)."""
    st = settings_row(ctx)
    if cap.source == "file":
        _persist(ctx, cap, [Ph.statement_handoff(ctx, cap, rows=None, account_id=plan.account_id)], emit, pos)
        return "rules", None
    if cap.source == "photo":
        env = photo_env(ctx, cap, resolved=plan.resolved, emit=emit, pos=pos)
        drafts = Ph.interpret(
            ctx, cap, env, hint=(plan.hint or "auto").lower(), caption=cap.text, account_id=plan.account_id
        )
        _persist(ctx, cap, drafts, emit, pos)
        used_ai = env.vision is not None or bool(getattr(env, "made", []))
        if not used_ai and plan.resolved is None:
            emit_reply(ctx, emit, cap, dict(FALLBACK_CARD), position=pos.take())
        return ("ai" if used_ai else "rules"), None
    world = ports.build_world(ctx, at=cap.at)
    hint = plan.hint.lower() if plan.hint else None
    if plan.resolved is not None:
        try:
            reply, run = agent.run_capture_agent(
                ctx,
                cap,
                plan.resolved,
                world=world,
                emit=emit,
                text=cap.text,
                journal_in_qa=st.journal_in_qa,
                start=pos.n,
            )
            pos.n = run.position
            return "ai", reply or None
        except seams.SeamError:
            if C.cards_of(ctx, cap.id) or C.replies_of(ctx, cap.id):
                emit_reply(ctx, emit, cap, dict(UNAVAILABLE_CARD), position=pos.take())
                return "ai", None
            drafts = parse_capture(world, cap.text, ParseCtx(source=cap.source, hint=hint))
            _persist(ctx, cap, drafts, emit, pos, actor="ai")
            emit_reply(ctx, emit, cap, dict(UNAVAILABLE_CARD), position=pos.take())
            return "rules", None
    drafts = parse_capture(world, cap.text, ParseCtx(source=cap.source, hint=hint))
    _persist(ctx, cap, drafts, emit, pos)
    emit_reply(ctx, emit, cap, dict(FALLBACK_CARD), position=pos.take())
    return "rules", None


def _views(ctx: Ctx, cap: Capture) -> list[rules.ItemView]:
    v = [rules.ItemView("record", c.state) for c in C.cards_of(ctx, cap.id)]
    v += [
        rules.ItemView("answer" if r.kind == "answer" else "info", tone=str(r.body.get("tone")))
        for r in C.replies_of(ctx, cap.id)
    ]
    return v


def run(ctx: Ctx, cap: Capture, plan: Plan, emit: Emit = _noop) -> Capture:
    """Interpret a stored capture and commit the result. Errors after this
    point are frames (and a ``failed`` capture), never a lost input."""
    cap.status = "processing"
    cap.started_at = ctx.now
    cap.error_code = None
    ctx.session.add(cap)
    ctx.session.flush()
    emit("capture", CapturePublic.model_validate(cap).model_dump(mode="json"))
    pos = Pos()
    sp = ctx.session.begin_nested()
    try:
        engine, reply = _interpret(ctx, cap, plan, emit, pos)
        sp.commit()
    except Exception:  # noqa: BLE001 - any failure keeps the input and says so
        sp.rollback()
        ctx.session.refresh(cap)
        _fail(ctx, cap, "interpret_failed", "Couldn't process that", "Your input is kept.")
        ctx.commit()
        emit("error", {"code": "interpret_failed", "message": "Couldn't process that. Your input is kept."})
        emit("done", detail(ctx, cap).model_dump(mode="json"))
        return cap
    views = _views(ctx, cap)
    cap.status = rules.status_of(views)
    cap.reply_text = (reply or rules.reply_text(views))[:8000]
    cap.engine = engine
    ctx.session.add(cap)
    ctx.commit()
    emit("done", detail(ctx, cap).model_dump(mode="json"))
    return cap


def process(ctx: Ctx, cap: Capture, emit: Emit = _noop) -> Capture:
    return run(ctx, cap, preflight(ctx, cap), emit)


# ---------------------------------------------------------------- SSE


def sse(event: str, data: dict[str, Any]) -> str:
    body = json.dumps(data, ensure_ascii=False, default=str)
    return f"event: {event}\ndata: {body}\n\n"


def stream_work(work: Callable[[Emit], None], *, name: str = "ai-reply") -> Iterator[str]:
    """Run ``work(emit)`` on a worker thread and yield its frames as SSE as
    they come. The generator waits for the worker before it ends, so the
    request's database session outlives every use of it. An unexpected
    failure becomes an ``error`` frame with a fixed message."""
    q: queue.Queue[tuple[str, dict[str, Any]] | None] = queue.Queue()

    def run_it() -> None:
        try:
            work(lambda e, d: q.put((e, d)))
        except Exception:  # noqa: BLE001 - reported as a frame, never as text
            q.put(("error", {"code": "reply_failed", "message": "Couldn't finish that reply."}))
        finally:
            q.put(None)

    t = threading.Thread(target=run_it, name=name, daemon=True)
    t.start()
    try:
        while True:
            item = q.get()
            if item is None:
                break
            yield sse(*item)
    finally:
        t.join()


def stream(ctx: Ctx, cap: Capture, plan: Plan) -> Iterator[str]:
    return stream_work(lambda emit: _run_quiet(ctx, cap, plan, emit), name=f"capture-{cap.id}")


def _run_quiet(ctx: Ctx, cap: Capture, plan: Plan, emit: Emit) -> None:
    run(ctx, cap, plan, emit)


# ---------------------------------------------------------------- recovery


def _clear_reply(ctx: Ctx, cap: Capture, *, revert: bool) -> None:
    for c in C.cards_of(ctx, cap.id):
        if revert and c.state in rules.WRITTEN:
            C.undo_row(ctx, c, actor="user")
        owned_repo.soft_delete(ctx, c)
    for r in C.replies_of(ctx, cap.id):
        owned_repo.soft_delete(ctx, r)


def retry(ctx: Ctx, *, capture_id: uuid.UUID, emit: Emit = _noop) -> Capture:
    """CAP-14 retry / process a queued capture. Only queued or failed."""
    cap = C.require_capture(ctx, capture_id)
    if cap.status not in ("queued", "failed"):
        raise conflict("capture_not_retryable", "This capture was already read")
    _clear_reply(ctx, cap, revert=False)
    return process(ctx, cap, emit)


def rerun(ctx: Ctx, *, capture_id: uuid.UUID, text: str | None) -> Capture:
    """CAP-13 re-run: undo what the capture wrote, then read it again."""
    cap = C.require_capture(ctx, capture_id)
    if cap.status in ("queued", "processing"):
        raise conflict("capture_busy", "This capture hasn't finished yet")
    _clear_reply(ctx, cap, revert=True)
    if text is not None:
        cap.text = text.strip()
        if cap.source == "voice":
            cap.transcript = cap.text
    ctx.session.add(cap)
    ctx.session.flush()
    return process(ctx, cap)


def resume(ctx: Ctx, *, capture_id: uuid.UUID) -> Capture:
    """A capture left ``processing`` (the request died mid-read)."""
    cap = C.require_capture(ctx, capture_id)
    if cap.status != "processing":
        raise conflict("capture_not_stuck", "This capture isn't stuck")
    if cap.started_at and ctx.now - cap.started_at < STUCK_AFTER:
        raise conflict("capture_still_running", "Give it a moment — it's still reading")
    _clear_reply(ctx, cap, revert=True)
    return process(ctx, cap)


def resume_stuck(ctx: Ctx) -> int:
    rows = owned_repo.list_rows(
        ctx,
        Capture,
        col(Capture.status) == "processing",
        col(Capture.started_at) < ctx.now - STUCK_AFTER,
        limit=20,
    )
    for cap in rows:
        _clear_reply(ctx, cap, revert=True)
        try:
            process(ctx, cap)
        except HTTPException:
            continue
    return len(rows)


def _tombstone(ctx: Ctx, cap: Capture) -> None:
    for c in C.cards_of(ctx, cap.id):
        for lg in C.log_of(ctx, c.id):
            owned_repo.soft_delete(ctx, lg)
        owned_repo.soft_delete(ctx, c)
    for r in C.replies_of(ctx, cap.id):
        owned_repo.soft_delete(ctx, r)
    for a in owned_repo.list_rows(ctx, CaptureAttachment, col(CaptureAttachment.capture_id) == cap.id):
        owned_repo.soft_delete(ctx, a)
    owned_repo.soft_delete(ctx, cap)


def delete(ctx: Ctx, *, capture_id: uuid.UUID) -> None:
    """Delete a capture from the thread and history. The records it wrote
    stay in their modules (they are the user's data now)."""
    _tombstone(ctx, C.require_capture(ctx, capture_id))
    ctx.commit()


def clear_thread(ctx: Ctx) -> int:
    rows = owned_repo.list_rows(ctx, Capture)
    for cap in rows:
        _tombstone(ctx, cap)
    ctx.commit()
    return len(rows)


def purge_expired(ctx: Ctx) -> int:
    """The retention job: captures older than ``retention_days`` leave the
    thread and history (tombstoned so devices drop them too)."""
    st = settings_row(ctx)
    cutoff = ctx.now - timedelta(days=st.retention_days)
    rows = owned_repo.list_rows(ctx, Capture, col(Capture.at) < cutoff, limit=5000)
    for cap in rows:
        _tombstone(ctx, cap)
    ctx.commit()
    return len(rows)


def quick_add(ctx: Ctx, *, client_uuid: uuid.UUID, text: str, payload: dict[str, Any]) -> Capture:
    """CAP-09/10 ``logQuickAdd``: a hand-entered record saved at once, kept
    as a capture with one card so the toast's Undo works the same way."""
    existing = owned_repo.find_one(
        ctx, Capture, col(Capture.client_uuid) == client_uuid, include_deleted=True
    )
    if existing is not None:
        return existing
    cap = owned_repo.insert(
        ctx,
        Capture,
        {
            "client_uuid": client_uuid,
            "at": ctx.now,
            "source": "quick_add",
            "text": text or str(payload.get("kind")),
            "status": "done",
            "reply_text": "Added by hand.",
            "engine": "rules",
        },
    )
    kind = str(payload["kind"])
    d = RecordDraft(kind=kind, target=C.TARGET_OF.get(kind, "finance"), rule="structure", payload=payload, confirm=True)
    card = C.new_card(ctx, cap, d, position=0, actor="user")
    if not C.save(ctx, card, cap, actor="user"):
        raise invalid("card_save_failed", C.SAVE_FAILED)
    ctx.commit()
    return cap


def thread(
    ctx: Ctx, *, status: str | None, source: str | None, q: str | None, skip: int, limit: int
) -> tuple[list[Capture], int]:
    where: list[Any] = []
    if status:
        where.append(col(Capture.status) == status)
    if source:
        where.append(col(Capture.source) == source)
    if q:
        where.append(col(Capture.text).icontains(q.replace("%", "").replace("_", "")))
    rows = owned_repo.list_rows(
        ctx, Capture, *where, order_by=[col(Capture.at).desc()], skip=skip, limit=limit
    )
    return rows, owned_repo.count_rows(ctx, Capture, *where)


__all__ = ["CardWriteLog"]
