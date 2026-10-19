"""Pure capture rules: tiers, the record-card state machine, the capture's
status and the one-line reply (prototype ``engine.ts``)."""

from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from typing import Any, Literal

Tier = Literal["auto", "confirm"]
CardState = Literal["proposed", "needs_input", "saved", "edited", "undone", "discarded"]
Op = Literal["confirm", "discard", "undo", "redo", "edit", "answer", "skip"]

DEFAULT_RULES: dict[str, Tier] = {
    "habit": "auto",
    "task": "auto",
    "reminder": "confirm",
    "workout": "auto",
    "weighIn": "auto",
    "meal": "confirm",
    "expense": "auto",
    "income": "confirm",
    "transfer": "confirm",
    "journal": "auto",
    "structure": "confirm",
}
RULE_KEYS = tuple(DEFAULT_RULES)
DEFAULT_MONEY_THRESHOLD_MINOR = 100_000  # prototype moneyThreshold: P1,000

# Which card operation each state allows. The prototype let discard run on a
# saved card (leaving its rows behind) and edit on an undone one; the server
# refuses both: discard is for what was never written, undo for what was.
ALLOWED: dict[str, frozenset[str]] = {
    "proposed": frozenset({"confirm", "discard", "edit"}),
    "needs_input": frozenset({"answer", "skip", "discard", "edit"}),
    "saved": frozenset({"undo", "edit"}),
    "edited": frozenset({"undo", "edit"}),
    "undone": frozenset({"redo"}),
    "discarded": frozenset(),
}
WRITTEN = frozenset({"saved", "edited"})


def allowed(state: str, op: str) -> bool:
    return op in ALLOWED.get(state, frozenset())


def tier_for(
    *,
    rule: str,
    payload: Mapping[str, Any],
    confirm: bool | None,
    source: str,
    rules: Mapping[str, str],
    money_threshold_minor: int,
) -> Tier:
    """``tierFor``: a photo, a parser flag, an expense above the threshold or
    without a category always asks; everything else follows the user's rule
    for the record type."""
    if confirm or source == "photo":
        return "confirm"
    if payload.get("kind") == "expense":
        if int(payload.get("amount_minor", 0)) > money_threshold_minor:
            return "confirm"
        if not payload.get("category_id"):
            return "confirm"
    tier = rules.get(rule, DEFAULT_RULES.get(rule, "confirm"))
    return "auto" if tier == "auto" else "confirm"


@dataclass(frozen=True)
class ItemView:
    """What :func:`status_of` and :func:`reply_text` need of a reply item."""

    t: Literal["record", "answer", "info"]
    state: str | None = None
    tone: str | None = None


def status_of(items: Iterable[ItemView]) -> str:
    items = list(items)
    recs = [i for i in items if i.t == "record"]
    if any(r.state == "needs_input" for r in recs):
        return "needs_input"
    if not recs:
        return "answered" if any(i.t == "answer" for i in items) else "done"
    return "done"


def reply_text(items: Iterable[ItemView]) -> str:
    items = list(items)
    recs = [i for i in items if i.t == "record"]
    saved = sum(1 for r in recs if r.state == "saved")
    to_confirm = sum(1 for r in recs if r.state == "proposed")
    asks = sum(1 for r in recs if r.state == "needs_input")
    answers = sum(1 for i in items if i.t == "answer")
    parts: list[str] = []
    if saved:
        parts.append(f"Logged {'it' if saved == 1 else f'{saved} things'}")
    if to_confirm:
        parts.append(f"{'one' if to_confirm == 1 else to_confirm} to confirm")
    if asks:
        parts.append("one quick question" if asks == 1 else f"{asks} questions")
    if not parts and answers:
        return "Here's what your data says."
    if not parts:
        suggest = any(i.t == "info" and i.tone == "journal-suggest" for i in items)
        return "Heard you." if suggest else "Hmm."
    s = ", ".join(parts)
    return f"{s[:1].upper()}{s[1:]}."
