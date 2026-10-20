"""Cross-module contract of the capture module (implemented by capture).

None of these commit unless the docstring says so: the calling use case does.
"""

import uuid
from collections.abc import Callable
from datetime import date
from typing import Any, Literal

from langchain_core.messages import BaseMessage
from langchain_core.tools import BaseTool

from app.modules.ai_providers.public import ResolvedModel
from app.modules.capture import agent, engine, journal, seams
from app.modules.capture.models import AISettings, Capture, JournalEntry
from app.modules.capture.schema import CaptureIn
from app.shared import owned_repo
from app.shared.context import Ctx

SeamError = seams.SeamError
sse = engine.sse
stream_work = engine.stream_work


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
    used by Sol when a message is a log rather than a question. A replay
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
) -> str:
    """The metered model/tools LangGraph loop capture runs, for the other AI
    surfaces (Sol, the finance advisor). Raises :class:`SeamError` when the
    provider fails; nothing a provider said reaches the error."""
    return agent.run_loop(
        ctx,
        resolved,
        system=system,
        messages=messages,
        tools=tools,
        on_text=on_text,
        max_turns=max_turns,
    )


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
