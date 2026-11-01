"""The shared catalog: exercises, foods and workout routines are app-wide.

Every member of a tenant reads and uses every catalog row; ``owner_id`` on a
catalog row is its author. Only the author or an admin (superuser) may edit,
merge or delete it (:func:`app.shared.owned_repo.can_write`), so one member
can never rewrite the numbers another member logs against.

Because the catalog is shared, a create must reuse what exists. Names are
compared by :func:`exercise_key`: folded words, plural and spelling variants
collapsed, word order ignored, and a few machine-only lifts collapsed to one
name ("Pec deck", "Pec deck machine", "Pec deck fly", "Butterfly" are one
exercise). :func:`resolve_exercise` adds two looser steps for names a person
or Fern says: the name without its equipment words when exactly one catalog
exercise shares it, then a close spelling ("pec dek").

The migration that merged the duplicates already in the database carries a
frozen copy of :func:`exercise_key` and :func:`bare_key`; change both
together only in a new migration.
"""

import difflib
import re
from collections.abc import Sequence
from typing import Protocol, TypeVar

# Spelling variants folded to one word before comparing.
SYNONYMS = {
    "flye": "fly",
    "flyes": "fly",
    "flys": "fly",
    "flies": "fly",
    "db": "dumbbell",
    "dumbell": "dumbbell",
    "dumbells": "dumbbell",
    "bb": "barbell",
    "kb": "kettlebell",
    "tricep": "triceps",
    "bicep": "biceps",
    "pecs": "pec",
    "pulldowns": "pulldown",
    "pushdowns": "pushdown",
    "pullups": "pullup",
    "chinups": "chinup",
    "situps": "situp",
    "pushups": "pushup",
}
# Phrases spelled several ways, joined to one token first.
PHRASES = (
    ("pull down", "pulldown"),
    ("push down", "pushdown"),
    ("pull up", "pullup"),
    ("chin up", "chinup"),
    ("push up", "pushup"),
    ("sit up", "situp"),
    ("pec dec", "pec deck"),
    ("ohp", "overhead press"),
)
# Words that never tell two exercises apart.
NOISE = {"the", "a", "an", "of", "on", "with", "w", "exercise"}
# Words naming the equipment rather than the movement.
EQUIPMENT = {
    "machine",
    "barbell",
    "dumbbell",
    "cable",
    "smith",
    "kettlebell",
    "band",
    "ez",
    "bodyweight",
    "plate",
    "loaded",
}
# Lifts that only exist on a machine: "machine" adds nothing to their name.
MACHINE_ONLY = (
    frozenset({"leg", "press"}),
    frozenset({"leg", "extension"}),
    frozenset({"leg", "curl"}),
    frozenset({"hack", "squat"}),
    frozenset({"lat", "pulldown"}),
)
PEC_DECK = frozenset({"pec", "deck"})
# Words that make a pec-deck movement the rear-delt one, not the chest fly.
REAR = {"rear", "reverse", "delt", "delts"}
# How close a typo must be (difflib ratio on the keys) to count.
CLOSE = 0.9


def fold(name: str) -> str:
    """Lower case, plain words, single spaces."""
    return " ".join(re.findall(r"[a-z0-9]+", name.lower()))


def _singular(w: str) -> str:
    if len(w) <= 3 or w.endswith("ss") or w in {"biceps", "triceps", "abs"}:
        return w
    if w.endswith("ies"):
        return w[:-3] + "y"
    if w.endswith(("sses", "xes", "ches", "shes")):
        return w[:-2]
    if w.endswith("s"):
        return w[:-1]
    return w


def _tokens(name: str) -> set[str]:
    text = f" {fold(name)} "
    for phrase, joined in PHRASES:
        text = text.replace(f" {phrase} ", f" {joined} ")
    words = (SYNONYMS.get(w, w) for w in text.split())
    out = {_singular(w) for phrase in words for w in phrase.split()}
    return out - NOISE


def _family(words: set[str]) -> set[str]:
    rear = bool(words & REAR)
    if not rear and (
        "pec" in words
        or "butterfly" in words
        or words in ({"fly", "machine"}, {"chest", "fly", "machine"})
    ):
        return set(PEC_DECK)
    if frozenset(words - {"machine"}) in MACHINE_ONLY:
        return words - {"machine"}
    return words


def exercise_key(name: str) -> str:
    """The name as compared for sameness: two exercises with one key are the
    same exercise."""
    return " ".join(sorted(_family(_tokens(name))))


def bare_key(name: str) -> str:
    """The key without equipment words ("shoulder press" for "Shoulder press
    machine")."""
    return " ".join(sorted(_family(_tokens(name)) - EQUIPMENT))


def gear(name: str) -> frozenset[str]:
    """The equipment words of a name, after the family collapse."""
    return frozenset(_family(_tokens(name)) & EQUIPMENT)


class Titled(Protocol):
    name: str


class Named(Titled, Protocol):
    aliases: list[str]


N = TypeVar("N", bound=Named)
T = TypeVar("T", bound=Titled)


def _names(row: Named) -> list[str]:
    return [row.name, *(row.aliases or [])]


def resolve_exercise(name: str, rows: Sequence[N]) -> N | None:
    """The catalog exercise ``name`` means, or None when it is new.

    In order: the same key (any name or alias of the row; the first such row
    in ``rows`` order when several share it); the same bare key when exactly
    one row has it; a close spelling of exactly one row's key."""
    key = exercise_key(name)
    if not key:
        return None
    exact = next((r for r in rows if key in {exercise_key(n) for n in _names(r)}), None)
    if exact is not None:
        return exact
    bare = bare_key(name)
    if bare:
        hits = {id(r): r for r in rows for n in _names(r) if bare_key(n) == bare}
        if len(hits) == 1:
            return next(iter(hits.values()))
    scored = sorted(
        (
            (difflib.SequenceMatcher(None, key, exercise_key(n)).ratio(), id(r), r)
            for r in rows
            for n in _names(r)
        ),
        key=lambda s: -s[0],
    )
    close = {s[1]: s[2] for s in scored if s[0] >= CLOSE}
    return next(iter(close.values())) if len(close) == 1 else None


def routine_key(name: str) -> str:
    """A routine's name as compared: folded, word order kept ("Push A" and
    "push a" are one routine; "A push" is another)."""
    return fold(name)


def resolve_routine(name: str, rows: Sequence[T]) -> T | None:
    """The catalog routine called ``name`` (folded; the first in ``rows``
    order), or the one routine whose name is a close spelling of it."""
    key = routine_key(name)
    if not key:
        return None
    exact = next((r for r in rows if routine_key(r.name) == key), None)
    if exact is not None:
        return exact
    close = [
        r
        for r in rows
        if difflib.SequenceMatcher(None, key, routine_key(r.name)).ratio() >= CLOSE
    ]
    return close[0] if len(close) == 1 else None
