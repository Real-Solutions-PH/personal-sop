"""Cross-module contract of the capture module (implemented by capture).

None of these commit unless the docstring says so: the calling use case does.
"""

import uuid
from collections.abc import Callable
from datetime import date
from typing import Any, Literal

from langchain_core.messages import BaseMessage
from langchain_core.tools import BaseTool
from sqlmodel import col

from app.modules.ai_providers.public import ResolvedModel
from app.modules.capture import agent, engine, journal, ports, rules, seams
from app.modules.capture.models import AISettings, Capture, JournalEntry
from app.modules.capture.schema import CaptureIn
from app.shared import owned_repo
from app.shared.context import Ctx

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
) -> tuple[list[BaseTool], agent.Run]:
    """Capture's writing tools for one chat turn (ADR-0015). Each write is a
    card on the turn's own capture (source ``chat``), tiered and undoable
    like any capture card. The capture is made on the first write and is
    replay-safe on ``client_uuid``; a turn that only answers makes none.
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
