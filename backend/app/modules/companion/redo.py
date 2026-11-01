"""Fern's ``redo_undone``: save again an entry the person Undid.

An Undone card had no way back from chat: "confirm it again" found nothing
waiting, so Fern said nothing was there (Kai, 2026-11-01). This finds the
most recent card a chat turn wrote and the person then undid, and redoes it
through the capture module's own redo (the Redo the card's toast offers),
so the same checks run as on the card.
"""

from datetime import timedelta
from typing import Any

from fastapi import HTTPException
from sqlmodel import col

from app.modules.capture import cards as capture_cards
from app.modules.capture import public as capture
from app.modules.capture.models import Capture, RecordCard
from app.shared import owned_repo
from app.shared.context import Ctx

RECENT_HOURS = 36


def undone_chat_cards(ctx: Ctx) -> list[RecordCard]:
    """Cards from recent chat turns that the person undid, newest change
    first."""
    caps = owned_repo.list_rows(
        ctx,
        Capture,
        col(Capture.source) == "chat",
        col(Capture.at) >= ctx.now - timedelta(hours=RECENT_HOURS),
    )
    if not caps:
        return []
    return owned_repo.list_rows(
        ctx,
        RecordCard,
        col(RecordCard.capture_id).in_([c.id for c in caps]),
        col(RecordCard.state) == "undone",
        order_by=[col(RecordCard.updated_at).desc()],
    )


def redo_undone(ctx: Ctx, *, what: str | None = None) -> dict[str, Any]:
    """Redo the newest undone chat card, or the newest whose label shares a
    word with ``what``. Flushes only."""
    cards = undone_chat_cards(ctx)
    if what:
        words = {w for w in what.lower().split() if len(w) > 2}
        cards = [
            c for c in cards if words & set(capture.card_label(ctx, c).lower().split())
        ] or cards
    if not cards:
        return {"error": "nothing_undone_recently"}
    card = cards[0]
    label = capture.card_label(ctx, card)
    try:
        capture_cards.redo_row(ctx, card)
    except HTTPException as exc:
        detail: dict[str, Any] = exc.detail if isinstance(exc.detail, dict) else {}
        return {"error": "could_not_redo", "what": label, "why": detail.get("message")}
    return {
        "redone": label,
        "card_id": str(card.id),
        "state": card.state,
        # The step's sentence (turn.outcome reads ``summary``).
        "summary": f"Saved again: {label}",
    }
