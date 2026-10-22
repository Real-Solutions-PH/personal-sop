"""Cross-module contract of the capture module (implemented by capture).

None of these commit unless the docstring says so: the calling use case does.
"""

import uuid
from collections.abc import Callable
from datetime import date, timedelta
from typing import Any, Literal

from langchain_core.messages import BaseMessage
from langchain_core.tools import BaseTool
from sqlmodel import col

from app.modules.ai_providers.public import ResolvedModel
from app.modules.capture import agent, engine, journal, ports, rules, seams
from app.modules.capture import cards as C
from app.modules.capture.models import AISettings, Capture, JournalEntry, RecordCard
from app.modules.capture.schema import CaptureIn
from app.shared import owned_repo
from app.shared.context import Ctx
from app.shared.currency import money

SeamError = seams.SeamError
LoopHooks = agent.LoopHooks
ChatRun = agent.Run
sse = engine.sse
stream_work = engine.stream_work
CHAT_TEXT_CHARS = 4000


def add_journal_entry(
    ctx: Ctx,
    *,
    body: str,
    source: Literal["voice", "text", "wrapup"] = "text",
    day: date | None = None,
    mood: int | None = None,
    tags: list[str] | None = None,
    area: str | None = None,
    entry_id: uuid.UUID | None = None,
) -> JournalEntry:
    """A private journal entry (replay-safe on ``entry_id``). Flushes."""
    return journal.add_entry(
        ctx,
        body=body,
        source=source,
        day=day,
        mood=mood,
        tags=tags,
        area=area,
        entry_id=entry_id,
    )


def submit_capture(
    ctx: Ctx,
    *,
    client_uuid: uuid.UUID,
    text: str,
    source: Literal[
        "text", "voice", "photo", "file", "quick_add", "connector"
    ] = "text",
    emit: Callable[[str, dict[str, Any]], None] | None = None,
) -> Capture:
    """Record (idempotently on ``client_uuid``) and process a text capture;
    used by the companion when a message is a log rather than a question. A replay
    returns the capture already made. COMMITS (it is a whole use case: the
    capture pipeline commits its own savepoints). A budget refusal keeps the
    capture as ``failed`` and raises the 402/403."""
    out = engine.submit_and_keep(
        ctx, CaptureIn(client_uuid=client_uuid, text=text, source=source)
    )
    if not out.created:
        return out.capture
    return engine.process(ctx, out.capture, emit or engine._noop)


def capture_detail(ctx: Ctx, capture_id: uuid.UUID) -> dict[str, Any]:
    from app.modules.capture.cards import require_capture

    return engine.detail(ctx, require_capture(ctx, capture_id)).model_dump(mode="json")


def preferred_model(ctx: Ctx) -> str | None:
    """The model this user picked for the server's own key, if any. Reads
    only: resolving a model never creates the settings row."""
    row = owned_repo.find_one(ctx, AISettings)
    return row.model if row is not None else None


def ai_settings(ctx: Ctx) -> dict[str, Any]:
    """The user's AI settings (``journal_in_qa``, ``finance_scope``, ...)."""
    row = journal.settings_row(ctx)
    return {
        "journal_in_qa": row.journal_in_qa,
        "finance_scope": row.finance_scope,
        "language": row.language,
        "ai_enabled": row.ai_enabled,
    }


def run_agent(
    ctx: Ctx,
    resolved: ResolvedModel,
    *,
    system: str,
    messages: list[BaseMessage],
    tools: list[BaseTool],
    on_text: Callable[[str], None],
    max_turns: int = agent.MAX_TURNS,
    max_tool_calls: int | None = None,
    hooks: agent.LoopHooks | None = None,
) -> str:
    """The metered model/tools LangGraph loop capture runs, for the other AI
    surfaces (the companion, the finance advisor). Raises :class:`SeamError` when the
    provider fails; nothing a provider said reaches the error."""
    return agent.run_loop(
        ctx,
        resolved,
        system=system,
        messages=messages,
        tools=tools,
        on_text=on_text,
        max_turns=max_turns,
        max_tool_calls=max_tool_calls,
        hooks=hooks,
    )


def chat_write_tools(
    ctx: Ctx,
    *,
    client_uuid: uuid.UUID,
    text: str,
    emit: Callable[[str, dict[str, Any]], None],
    said: str | None = None,
) -> tuple[list[BaseTool], agent.Run]:
    """Capture's writing tools for one chat turn (ADR-0015). Each write is a
    card on the turn's own capture (source ``chat``), tiered and undoable
    like any capture card. The capture is made on the first write and is
    replay-safe on ``client_uuid``; a turn that only answers makes none.
    ``said`` is the person's words the turn answers (``text`` and what they
    said just before); a task keeps a date only when they name one.
    Flushes only."""

    def open_cap() -> Capture:
        existing = owned_repo.find_one(
            ctx, Capture, col(Capture.client_uuid) == client_uuid, include_deleted=True
        )
        if existing is not None:
            return existing
        return owned_repo.insert(
            ctx,
            Capture,
            {
                "client_uuid": client_uuid,
                "at": ctx.now,
                "source": "chat",
                "text": text.strip()[:CHAT_TEXT_CHARS],
                "status": "processing",
                "started_at": ctx.now,
                "engine": "ai",
            },
        )

    run = agent.Run(
        ctx=ctx,
        cap=None,
        world=ports.build_world(ctx),
        emit=emit,
        journal_in_qa=journal.settings_row(ctx).journal_in_qa,
        open_cap=open_cap,
        said=text if said is None else said,
    )
    return agent.write_tools(run), run


def finish_chat_capture(ctx: Ctx, run: agent.Run, *, reply: str) -> uuid.UUID | None:
    """Settle the turn's capture status from its cards (``done``, or
    ``needs_input`` while a card waits for the user). Flushes; returns the
    capture id, or None when the turn wrote nothing."""
    cap = run.cap
    if cap is None:
        return None
    cap.status = rules.status_of(engine._views(ctx, cap))
    cap.reply_text = reply[:8000] or None
    ctx.session.add(cap)
    ctx.session.flush()
    return cap.id


def meter(
    ctx: Ctx, resolved: ResolvedModel, msg: BaseMessage | None, *, ok: bool = True
) -> None:
    seams.meter(ctx, resolved, msg, ok=ok)


def answer_question(ctx: Ctx, question: str) -> dict[str, Any]:
    """The deterministic answer card for a question about the user's data."""
    from app.modules.capture import qa

    return qa.answer(
        ctx, question, journal_in_qa=journal.settings_row(ctx).journal_in_qa
    )


# How far back "confirm it" in chat reaches: the cards a recent chat turn
# left waiting, never a week-old proposal the person has forgotten.
WAITING_HOURS = 36


def card_label(ctx: Ctx, card: RecordCard) -> str:
    """A few words naming what a card would record ("expense ₱62.40 · Lunch")."""
    p: dict[str, Any] = dict(card.payload or {})
    kind = str(p.get("kind") or card.kind)
    if kind in ("expense", "income", "transfer"):
        amt = money(int(p.get("amount_minor") or 0), ctx.currency)
        what = p.get("payee") or p.get("note")
        return f"{kind} {amt}{f' · {what}' if what else ''}"
    if kind == "task":
        titles = [str(t.get("title", "")) for t in p.get("tasks") or []]
        return "task: " + ", ".join(t for t in titles if t)
    if kind == "weighIn":
        fat = p.get("body_fat_pct")
        return f"weigh-in {p.get('kg', '')} kg{f', {fat}% body fat' if fat else ''}"
    if kind == "meal":
        names = [str(i.get("name", "")) for i in (p.get("items") or [])[:2]]
        return "meal: " + ", ".join(n for n in names if n)
    return kind.replace("_", " ")


def waiting_chat_cards(ctx: Ctx) -> list[RecordCard]:
    """Cards that recent chat turns left waiting for the person (proposed,
    or needing an answer), oldest first."""
    caps = owned_repo.list_rows(
        ctx,
        Capture,
        col(Capture.source) == "chat",
        col(Capture.at) >= ctx.now - timedelta(hours=WAITING_HOURS),
    )
    if not caps:
        return []
    return owned_repo.list_rows(
        ctx,
        RecordCard,
        col(RecordCard.capture_id).in_([c.id for c in caps]),
        col(RecordCard.state).in_(["proposed", "needs_input"]),
        order_by=[col(RecordCard.created_at), col(RecordCard.position)],
    )


def settle_waiting(
    ctx: Ctx, *, action: Literal["confirm", "discard"]
) -> dict[str, Any]:
    """Confirm or discard what recent chat turns left waiting (Fern's
    ``confirm_pending`` / ``discard_pending``). A card the module refuses
    stays waiting and is reported with the reason (an expense with no
    account says so). Flushes only."""
    done: list[str] = []
    refused: list[dict[str, str]] = []
    for card in waiting_chat_cards(ctx):
        label = card_label(ctx, card)
        if action == "discard":
            C.discard_row(ctx, card)
            done.append(label)
            continue
        if card.state == "needs_input":
            q = (card.ask or {}).get("question")
            refused.append({"what": label, "why": str(q or "needs a detail first")})
            continue
        cap = C.require_capture(ctx, card.capture_id)
        why = C.try_save(ctx, card, cap, actor="user")
        C.refresh_status(ctx, cap)
        if why is None:
            done.append(label)
        else:
            refused.append({"what": label, "why": why.message})
    key = "confirmed" if action == "confirm" else "discarded"
    return {
        key: done,
        "not_saved": refused,
        "nothing_waiting": not done and not refused,
    }
