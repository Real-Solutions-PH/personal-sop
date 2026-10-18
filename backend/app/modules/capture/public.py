"""Cross-module contract of the capture module (implemented by capture)."""

import uuid
from datetime import date
from typing import Literal

from app.modules.capture.models import Capture, JournalEntry
from app.shared.context import Ctx


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
    raise NotImplementedError


def submit_capture(
    ctx: Ctx,
    *,
    client_uuid: uuid.UUID,
    text: str,
    source: Literal[
        "text", "voice", "photo", "file", "quick_add", "connector"
    ] = "text",
) -> Capture:
    """Record (idempotently on ``client_uuid``) and queue a capture; used by
    Sol when a message is a log rather than a question."""
    raise NotImplementedError
