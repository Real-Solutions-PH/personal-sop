"""The words speech to text should expect (Deepgram keyterm prompting).

Generic recognisers miss names they have never heard: "Fern" comes back as
"friend", "Maya Black" as "my black", "Chowking" as "choking". Nova-3 takes a
list of key terms per request and leans towards them. Measured on 350
synthetic clips (five voices, clean and noisy) of the person's own kind of
message, this list plus their own habit, exercise, account and food names
lifted the key-term hit rate from 77% to 88% and cut word errors from 18.3%
to 14.6% (language ``multi``).

Pure: no I/O. ``ports.speech_names`` gathers the person's names.
"""

import re
from collections.abc import Iterable

# Deepgram refuses a request whose key terms exceed 500 tokens in all.
# Probed on 2026-10-23: 1,176 characters of real names passed and 100 short
# odd strings (~1,000 characters) failed, so tokens run at about two
# characters each at worst. 800 characters keeps under 400 tokens.
MAX_CHARS = 800
MAX_TERMS = 100
MAX_WORDS = 4

# The assistant's name, then food, places and brands a person in the
# Philippines says that an English model has rarely heard.
FIXED = (
    "Fern",
    "Unfurl",
    "adobo",
    "sinigang",
    "tapsilog",
    "longsilog",
    "tocilog",
    "pancit canton",
    "pancit palabok",
    "pancit bihon",
    "lumpia",
    "lechon",
    "kare-kare",
    "bagoong",
    "pinakbet",
    "galunggong",
    "longganisa",
    "tocino",
    "turon",
    "halo-halo",
    "merienda",
    "pasalubong",
    "ulam",
    "sisig",
    "bulalo",
    "tinola",
    "champorado",
    "taho",
    "ensaymada",
    "pandesal",
    "Jollibee",
    "Chowking",
    "Mang Inasal",
    "Meralco",
    "PLDT",
    "Grab",
    "GCash",
    "Maya",
    "Shopee",
    "Lazada",
    "7-Eleven",
    "Monster",
    "Quaker",
    "whey protein",
)


def clean_name(name: str) -> str | None:
    """A stored name as it is said: no bracketed sizes or notes, nothing
    after a comma or a "with"/"in"/"from" clause, at most four words.
    "Betagro Garlic Butter Tender Chicken Breast (90 g)" -> "Betagro Garlic
    Butter Tender"; None when nothing sayable is left."""
    n = re.sub(r"\([^)]*\)", " ", name)
    n = re.split(r",| with | in | from ", n)[0]
    n = re.sub(r"[^\w\s'&.-]", " ", n)
    words = n.split()
    if not words:
        return None
    out = " ".join(words[:MAX_WORDS])
    return out if len(out) >= 3 else None


def keyterms(names: Iterable[str], foods: Iterable[str] = ()) -> list[str]:
    """ "Fern", the person's own names (habits, exercises, accounts), the
    fixed list, then their food library, each in the order given;
    deduplicated without regard to case and cut to the request budget (the
    food library is long, so it goes last)."""
    seen: set[str] = set()
    out: list[str] = []
    used = 0
    own = [c for c in map(clean_name, names) if c]
    food = [c for c in map(clean_name, foods) if c]
    for t in [FIXED[0], *own, *FIXED[1:], *food]:
        k = t.casefold()
        if k in seen:
            continue
        if len(out) >= MAX_TERMS or used + len(t) > MAX_CHARS:
            break
        seen.add(k)
        out.append(t)
        used += len(t)
    return out
