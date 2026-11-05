"""Fern's one-time offer to bring back a hidden part.

A part is hidden when its module is switched off in Settings or, for the
Journal and Community, when the person hid that extra. When Fern hears
something that belongs to a hidden part (an entry written into it, or, for
the Journal, a feeling said out loud) and has never offered that part, the
reply carries one ``module_intro`` block: what the part adds, with "Turn on"
and "Not for me" buttons. The offer is stored on the account
(``intro_offered``) so it is made once, ever; "Not for me" stores
``intro_dismissed`` and the part is never offered again.
"""

import re
from collections.abc import Iterable
from typing import Any

# Said by someone with the Journal hidden, this is what the Journal is for.
# Kept narrow: a first-person feeling, not any word about mood.
FEELING = re.compile(
    r"\bi\s+(feel|felt)\b|"
    r"\b(feel|felt|feeling)\s+(so\s+|really\s+|a\s+bit\s+|kinda\s+|very\s+)?"
    r"(anxious|stressed|sad|down|low|lonely|overwhelmed|happy|grateful|great|"
    r"awful|tired|burnt?\s*out|depressed|angry|calm|okay|meh)\b",
    re.I,
)

LABEL = {
    "habits": "Habits",
    "tasks": "Tasks",
    "fitness": "Fitness",
    "nutrition": "Nutrition",
    "focus": "Focus",
    "finance": "Finance",
    "screen": "Screen time",
    "journal": "Journal",
    "social": "Community",
}
# What each part adds, in the words of the app's day-14 card.
ADDS = {
    "habits": "It keeps your daily routines on Today, with a streak for each.",
    "tasks": "It puts what's due today on Today, with reminders.",
    "fitness": "It shows workouts, steps and sleep on Today.",
    "nutrition": "It tracks meals against your calorie and protein target.",
    "focus": "It times deep work against a daily goal.",
    "finance": "It shows spending, bills coming up and budgets on Today.",
    "screen": "It shows your phone time against a daily limit.",
    "journal": "It keeps a daily mood check-in and notes like this one.",
    "social": "It shares wins with friends and lets them cheer you on.",
}


def heard(said: str, written: Iterable[str]) -> list[str]:
    """The parts this turn touched: modules it wrote into, in order, and the
    Journal when the person said how they feel."""
    out = list(dict.fromkeys(written))
    if FEELING.search(said) and "journal" not in out:
        out.append("journal")
    return out


def to_offer(
    touched: Iterable[str],
    *,
    hidden: Iterable[str],
    offered: Iterable[str],
    dismissed: Iterable[str],
) -> list[str]:
    """The hidden parts among ``touched`` never offered nor turned down."""
    shut, done = set(hidden), set(offered) | set(dismissed)
    return [m for m in dict.fromkeys(touched) if m in shut and m not in done]


def block(part: str) -> dict[str, Any]:
    return {
        "t": "module_intro",
        "module": part,
        "text": f"{LABEL[part]} is hidden. {ADDS[part]} Want it back?",
    }
