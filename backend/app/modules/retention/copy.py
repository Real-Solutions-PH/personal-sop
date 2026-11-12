"""What an engagement nudge says (docs/26-retention-algorithms.md §3.3, §6).

Fern's voice (docs/brand/fern.md): calm, plain, one idea, one next step.
Every message names the companion by its current name, points at one thing
the person set up (a habit or a task of theirs) with a deep link to it, and
never uses loss-aversion copy: no "at risk", "lose", "about to end", "don't
break", "you missed again", and no emoji (a test sweeps the catalogue).

Nothing sensitive reaches the lock screen: the only personal text is the
title of a habit or task the person wrote, never an amount, a weight or a
food.
"""

from dataclasses import dataclass
from typing import Literal

from app.modules.retention.logic import NudgeKind

SETTINGS_HREF = "/me/settings"
TODAY_HREF = "/today"
ITEM_TITLE_MAX = 60


@dataclass(frozen=True)
class Item:
    """The one thing a nudge points at: a habit due today or a task."""

    kind: Literal["habit", "task"]
    id: str
    title: str


@dataclass(frozen=True)
class Message:
    title: str
    body: str
    href: str


def item_href(item: Item) -> str:
    return f"/habits/{item.id}" if item.kind == "habit" else f"/tasks/task/{item.id}"


def _t(item: Item) -> str:
    title = " ".join(item.title.split())
    return title if len(title) <= ITEM_TITLE_MAX else title[: ITEM_TITLE_MAX - 1] + "…"


def render(
    kind: NudgeKind,
    *,
    name: str,
    item: Item | None,
    rest_ready: bool = False,
    way_back_ready: bool = False,
) -> Message | None:
    """The message for ``kind``, or None when it has nothing to point at
    (the best-time nudge and the day-3 step need a habit or task)."""
    if kind == "best_time":
        if item is None:
            return None
        if item.kind == "habit":
            body = f"{_t(item)} is open for today. One tap logs it."
            if rest_ready:
                body += " Rest day ready if today's a no."
        else:
            body = f"Next up: {_t(item)}. One tap opens it."
        return Message(name, body, item_href(item))
    if kind == "ladder_3":
        if item is None:
            return None
        what = (
            f"today's {_t(item)}"
            if item.kind == "habit"
            else f"your next task, {_t(item)}"
        )
        verb = "logs" if item.kind == "habit" else "opens"
        return Message(
            name,
            f"Yesterday and the day before were quiet. One tap {verb} {what}.",
            item_href(item),
        )
    if kind == "ladder_7":
        pause = (
            " Your streaks pause across the gap when you come back."
            if way_back_ready
            else ""
        )
        if item is None:
            return Message(
                name,
                f"It's been a week. Your plan is where you left it.{pause}",
                TODAY_HREF,
            )
        return Message(
            name,
            f"It's been a week. {_t(item)} is still on your list; one tap picks it up.{pause}",
            item_href(item),
        )
    if kind == "ladder_14":
        return Message(
            name,
            "I'll stay quiet from here. Your plan and history are kept. "
            "Prefer a weekly note? Tap to choose.",
            SETTINGS_HREF,
        )
    # ladder_30: the last one.
    if item is None:
        return Message(
            name,
            "A month since we last checked in. Your plan is where you left it.",
            TODAY_HREF,
        )
    return Message(
        name,
        f"A month since we last checked in. Here's where you left off: {_t(item)}.",
        item_href(item),
    )
