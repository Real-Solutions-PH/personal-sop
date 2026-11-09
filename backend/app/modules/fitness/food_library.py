"""The food library (``FoodItem``): saving a food's nutrition, finding it
again by name, and scaling it to the amount eaten. Built-in foods (a bulk
import of a public database made them, ``is_global``) are every member's
and read-only; every other food is its owner's alone (``catalog.py``). A
member copies a built-in food to make it their own.

Meal logging checks the library first, so a food read once from its label
gives the same numbers every time; only foods it has never seen fall back to
an estimate. Matching is by folded name or alias, then by every word of the
food's name appearing in what was said ("2 eggs" finds "Egg, whole,
hard-boiled" only through an alias, never by guesswork on one word).

The library also holds whole public databases (``food_import``: USDA
FoodData Central, Open Food Facts), so it runs to tens of thousands of
foods. Lookups never load all of them: they read the foods sharing a word
with what was said through a full-text index (``SEARCH_DOC``), then rank
them: the household's own foods first (verified before not), then USDA,
then Open Food Facts. An imported food is matched only by its name or an
alias, or by exactly the words said; never because a few of its words
appear in a longer dish name."""

import difflib
import math
import re
import uuid
from dataclasses import dataclass, field
from typing import Any, Literal, cast

from sqlalchemy import ColumnElement, String, TextClause, case, or_
from sqlalchemy import cast as sa_cast
from sqlalchemy import text as sql
from sqlmodel import col, func

from app.modules.fitness.models import FoodItem
from app.modules.media import public as media_public
from app.shared import owned_repo
from app.shared.context import Ctx
from app.shared.domain import conflict

NUTRIENTS = (
    "kcal",
    "protein",
    "carbs",
    "fat",
    "fiber",
    "sat_fat",
    "fiber_soluble",
    "fiber_insoluble",
    "sugar",
    "sodium",
)
# Units that count pieces or servings rather than weigh.
COUNT_UNITS = {
    "",
    "pc",
    "pcs",
    "piece",
    "pieces",
    "serving",
    "servings",
    "x",
    "egg",
    "eggs",
    "slice",
    "slices",
    "pack",
    "packs",
    "bar",
    "bars",
    "can",
    "cans",
    "bottle",
    "bottles",
    "cup",
    "cups",
    "scoop",
    "scoops",
    "sachet",
    "sachets",
    "packet",
    "packets",
    "pouch",
    "stick",
    "sticks",
}
GRAM_UNITS = {"g", "gram", "grams", "gm", "gms"}
# A weight written into an item's unit or name: "sachet (30g)", "Cooked
# white rice 150g".
_SAID_GRAMS = re.compile(r"(\d+(?:\.\d+)?)\s*(?:g|grams?|gms?)\b", re.I)
# Words that say nothing about which food it is.
FILLER = {"of", "the", "a", "an", "and", "with", "w", "my", "some", "plain"}


def fold(name: str) -> str:
    """A name as compared: lower case, plain words, single spaces."""
    return " ".join(re.findall(r"[a-z0-9]+", name.lower()))


def _words(name: str) -> set[str]:
    return {w for w in fold(name).split() if w not in FILLER and len(w) > 1}


@dataclass
class FoodDraft:
    name: str
    kcal: float
    protein: float = 0
    carbs: float = 0
    fat: float = 0
    fiber: float | None = None
    sat_fat: float | None = None
    fiber_soluble: float | None = None
    fiber_insoluble: float | None = None
    sugar: float | None = None
    sodium: float | None = None
    basis: str = "100g"
    unit_grams: float | None = None
    state: str | None = None
    aliases: list[str] = field(default_factory=list)
    source: str = "said"
    source_url: str | None = None
    external_ref: str | None = None
    barcode: str | None = None
    notes: str | None = None
    verified: bool = False


# Rows a bulk import made (``food_import``) are keyed "<source>:<id>"; a
# household food may carry the same ``source`` (Kai's Notion rows say
# "usda") and is still theirs.
BULK_PREFIXES = ("usda:", "off:", "philfct:")
SOURCE_LABEL = {
    "usda": "USDA FoodData Central",
    "off": "Open Food Facts",
    "philfct": "Philippine Food Composition Tables (FNRI)",
}
# The text the full-text index covers: the folded name and the aliases.
# The migration ``1d09f03e3aac`` builds ``ix_food_item_search`` on this
# exact expression; change both together or the index goes unused.
SEARCH_DOC = "to_tsvector('simple'::regconfig, key || ' ' || aliases::text)"
# The most foods one lookup reads (a word like "chicken" is in hundreds).
CANDIDATES = 600


def is_bulk(f: FoodItem) -> bool:
    """Whether a bulk import of a public database made this food."""
    return (getattr(f, "external_ref", None) or "").startswith(BULK_PREFIXES)


def tier(f: FoodItem) -> int:
    """How much a food is trusted, best first: the household's own verified
    foods, their other foods, then USDA (and FNRI), then Open Food Facts."""
    if not is_bulk(f):
        return 0 if getattr(f, "verified", False) else 1
    return 3 if f.source == "off" else 2


def _bulk_sql() -> Any:
    # COALESCE: a NULL ref must read as "not bulk", not as unknown.
    ref = func.coalesce(col(FoodItem.external_ref), "")
    return or_(*(ref.startswith(p) for p in BULK_PREFIXES))


def tier_sql() -> Any:
    """``tier`` as a SQL expression, for ORDER BY."""
    bulk = _bulk_sql()
    return case(
        (~bulk & col(FoodItem.verified), 0),
        (~bulk, 1),
        (col(FoodItem.source) == "off", 3),
        else_=2,
    )


def _tokens(texts: list[str]) -> list[str]:
    """Every word of ``texts``, with its singular and plural, for the
    full-text query."""
    out: set[str] = set()
    for t in texts:
        for w in fold(t).split():
            out.add(w)
            out.add(_plain(w))
            if len(w) > 2 and not w.endswith("s"):
                out.add(w + "s")
    return sorted(out)


def _matching(tokens: list[str], name: str) -> TextClause:
    return sql(f"{SEARCH_DOC} @@ to_tsquery('simple'::regconfig, :{name})").bindparams(
        **{name: " | ".join(tokens)}
    )


def _candidates(ctx: Ctx, texts: list[str]) -> list[FoodItem]:
    """The live foods sharing a word with any of ``texts``, most trusted
    first, then those sharing the most words; at most ``CANDIDATES``."""
    tokens = _tokens(texts)
    if not tokens:
        return []
    rank = sql(
        f"ts_rank({SEARCH_DOC}, to_tsquery('simple'::regconfig, :qr)) DESC"
    ).bindparams(qr=" | ".join(tokens))
    return owned_repo.list_rows(
        ctx,
        FoodItem,
        cast(ColumnElement[bool], _matching(tokens, "qm")),
        order_by=[tier_sql(), rank, func.length(col(FoodItem.key)), col(FoodItem.id)],
        limit=CANDIDATES,
    )


def _candidates_each(ctx: Ctx, names: list[str]) -> list[FoodItem]:
    """``_candidates`` for each name on its own, together: one shared query
    would spend its ``CANDIDATES`` on the commonest word ("chicken") and
    drop another item's foods ("banana")."""
    out: dict[Any, FoodItem] = {}
    for n in dict.fromkeys(names):
        for r in _candidates(ctx, [n]):
            out.setdefault(r.id, r)
    return list(out.values())


def _ranked(rows: list[FoodItem]) -> list[FoodItem]:
    """Rows in trust order (stable: the caller's order within a tier)."""
    return sorted(rows, key=tier)


_NOT_FOOD_WORDS = COUNT_UNITS | GRAM_UNITS


def _core_words(name: str) -> set[str]:
    """The words that name the food itself: no amounts or units, plurals
    folded ("2 cups cooked white rice" is {cooked, white, rice})."""
    return {
        _plain(w)
        for w in _words(name)
        if w not in _NOT_FOOD_WORDS and not any(ch.isdigit() for ch in w)
    }


def _plain(name: str) -> str:
    """A food name with plurals folded ("eggs" is "egg")."""
    return " ".join(
        w[:-1] if len(w) > 3 and w.endswith("s") and not w.endswith("ss") else w
        for w in fold(name).split()
    )


def same_food(name: str, rows: list[FoodItem]) -> FoodItem | None:
    """The library food a new food called ``name`` already is: the same
    name or alias, the same words but for plurals, or one food whose name is
    a close spelling of it ("japanese siomai" for "Japanese siomai")."""
    key = fold(name)
    rows = _ranked(rows)
    for r in rows:
        if r.key == key or key in (r.aliases or []):
            return r
    plain = _plain(name)
    for r in rows:
        if plain in {_plain(n) for n in [r.key, *(r.aliases or [])]}:
            return r
    close = {
        r.id: r
        for r in rows
        for n in [r.key, *(r.aliases or [])]
        if difflib.SequenceMatcher(None, plain, _plain(n)).ratio() >= 0.92
    }
    return next(iter(close.values())) if len(close) == 1 else None


def save_food(ctx: Ctx, d: FoodDraft) -> tuple[FoodItem, bool]:
    """Add a food, or update the one it already is (``same_food``, or the
    same import source). Returns the row and whether it was new. A built-in
    food is never changed: a draft that only re-states it reuses it, and one
    with the caller's own numbers for it (a label, what they said) becomes
    the caller's own food of that name, which then ranks first. Flushes
    only."""
    key = fold(d.name)
    if not key:
        raise ValueError("a food needs a name")
    rows = _candidates(ctx, [d.name, *d.aliases])
    by_ref = (
        owned_repo.list_rows(
            ctx, FoodItem, col(FoodItem.external_ref) == d.external_ref, limit=1
        )
        if d.external_ref
        else []
    )
    row = (by_ref[0] if by_ref else None) or same_food(d.name, rows)
    # A food the household saves (a label, what they said) never rewrites
    # an imported one it only resembles ("Banana" is an alias of USDA's
    # "Bananas, raw"): it becomes their own food, which then ranks first.
    if (
        row is not None
        and is_bulk(row)
        and not (d.external_ref or "").startswith(BULK_PREFIXES)
        and row.key != key
    ):
        row = None
    if row is not None and not owned_repo.can_write(ctx, row):
        if (d.external_ref or "").startswith(BULK_PREFIXES) or _restates(row, d):
            return row, False
        row, by_ref = None, []
    aliases = sorted({fold(a) for a in d.aliases if fold(a) and fold(a) != key})
    values: dict[str, Any] = {
        "name": d.name.strip()[:160],
        "key": key[:160],
        "basis": d.basis,
        "unit_grams": d.unit_grams,
        "state": d.state,
        "kcal": d.kcal,
        "protein": d.protein,
        "carbs": d.carbs,
        "fat": d.fat,
        "fiber": d.fiber,
        "sat_fat": d.sat_fat,
        "fiber_soluble": d.fiber_soluble,
        "fiber_insoluble": d.fiber_insoluble,
        "sugar": d.sugar,
        "sodium": d.sodium,
        "source": d.source,
        "source_url": d.source_url,
        "external_ref": d.external_ref,
        "barcode": d.barcode,
        "notes": d.notes,
        "verified": d.verified,
    }
    if row is None:
        return owned_repo.insert(ctx, FoodItem, values | {"aliases": aliases}), True
    # Keep the name it is known by (the said one becomes an alias) and the
    # aliases learned earlier; the new values replace the old ones.
    if not by_ref and row.key != key:
        values["name"], values["key"] = row.name, row.key
        aliases.append(key)
    merged = sorted(set(row.aliases or []) | set(aliases) - {row.key})
    for k, v in values.items():
        setattr(row, k, v)
    row.aliases = merged
    ctx.session.add(row)
    ctx.session.flush()
    return row, False


def _restates(row: FoodItem, d: FoodDraft) -> bool:
    """Whether the draft says what ``row`` already says: the same basis and
    the same calories and macros (within rounding, or 2%)."""
    if d.basis != row.basis:
        return False
    for n in ("kcal", "protein", "carbs", "fat"):
        mine, theirs = float(getattr(d, n) or 0), float(getattr(row, n) or 0)
        if abs(mine - theirs) > max(0.5, abs(theirs) * 0.02):
            return False
    return True


def find_food(
    ctx: Ctx, name: str, rows: list[FoodItem] | None = None
) -> FoodItem | None:
    """The library food this name refers to, if one clearly does: an exact
    name or alias first, then the food whose every name word was said (the
    most specific such food wins)."""
    return match_food(ctx, name, rows)[0]


def match_food(
    ctx: Ctx, name: str, rows: list[FoodItem] | None = None
) -> tuple[FoodItem | None, bool]:
    """``find_food`` with whether the match was exact (the name or an alias
    itself) rather than by shared words."""
    key = fold(name)
    if not key:
        return None, False
    rows = _ranked(_candidates(ctx, [name]) if rows is None else rows)
    for r in rows:
        if r.key == key or key in (r.aliases or []):
            return r, True
    said = _words(name)
    core = _core_words(name)
    best: tuple[int, FoodItem] | None = None
    for r in rows:
        for cand in [r.key, *(r.aliases or [])]:
            words = _words(cand)
            if not words or not words <= said:
                continue
            # An imported food only by exactly the words said: "Chicken,
            # broiler, meat only" must not stand in for "chicken adobo".
            if is_bulk(r) and _core_words(cand) != core:
                continue
            if best is None or len(words) > best[0]:
                best = (len(words), r)
    return (best[1], False) if best else (None, False)


def _agrees(item: dict[str, Any], values: dict[str, Any]) -> bool:
    """The item's own calories are near the library's for the same amount
    (within a third, or 40 kcal for small foods)."""
    mine, theirs = float(item.get("kcal") or 0), float(values.get("kcal") or 0)
    return abs(mine - theirs) <= max(40.0, theirs / 3)


def _names_words(f: FoodItem) -> list[set[str]]:
    return [{_plain(w) for w in _words(n)} for n in [f.key, *(f.aliases or [])]]


def _relevance(
    query: str, f: FoodItem, weight: dict[str, float]
) -> tuple[int, float, float]:
    """How well a food's name or best alias answers ``query``: (1 for the
    very name or alias else 0, the share of the query's words it has, each
    word weighted by how rare it is (``weight``), and the share of its own
    words the query has)."""
    key = fold(query)
    if f.key == key or key in (f.aliases or []):
        return 1, 1.0, 1.0
    q = _core_words(query) or {_plain(w) for w in _words(query)}
    total = sum(weight.get(w, 1.0) for w in q) or 1.0
    best = (0, 0.0, 0.0)
    for c in _names_words(f):
        common = q & c
        if common and c:
            share = sum(weight.get(w, 1.0) for w in common) / total
            best = max(best, (0, round(share, 2), round(len(common) / len(c), 2)))
    return best


def rank_foods(query: str, rows: list[FoodItem]) -> list[FoodItem]:
    """Foods sharing a word with ``query``, best answer first: the very
    name, then the most of the query's words, the rarer words counting
    more ("fried tilapia" is tilapia first: hundreds of foods are fried);
    among equals the most trusted source (``tier``), then the closest name,
    then the most used."""
    q = _core_words(query) or {_plain(w) for w in _words(query)}
    seen = [set().union(*_names_words(r)) for r in rows]
    weight = {w: 1 / math.log(2 + sum(w in ws for ws in seen)) for w in q}
    scored = [(_relevance(query, r, weight), r) for r in rows]
    scored = [(s, r) for s, r in scored if s[1] > 0]
    scored.sort(
        key=lambda sr: (
            -sr[0][0],
            -sr[0][1],
            tier(sr[1]),
            -sr[0][2],
            -(sr[1].use_count or 0),
            len(sr[1].name),
            sr[1].name,
        )
    )
    return [r for _, r in scored]


# Who a food came from, as the library shows it: a public database the
# server imported (USDA, Open Food Facts, FNRI), Fern (read from a label, or
# what someone told it, saved by its save_food tool), or the person
# themselves (their own import or recipe). A household row may carry a
# database's ``source`` (Kai's Notion rows say "usda"), so a database food is
# one a bulk import made, never one whose source merely names a database.
FERN_SOURCES = ("label", "said", "brand")
Origin = Literal["you", "fern", "database"]


def origin(f: FoodItem) -> Origin:
    """Who ``f`` came from (see ``FERN_SOURCES``)."""
    if is_bulk(f):
        return "database"
    return "fern" if f.source in FERN_SOURCES else "you"


def origin_sql(o: Origin) -> Any:
    """``origin(f) == o`` as a SQL filter."""
    bulk = _bulk_sql()
    if o == "database":
        return bulk
    fern = col(FoodItem.source).in_(FERN_SOURCES)
    return ~bulk & (fern if o == "fern" else ~fern)


def words_sql(text: str) -> list[Any]:
    """One filter per word of ``text``: every word must appear somewhere in
    the food's name, its folded key or its aliases, in any order ("adobo
    chicken" finds "Chicken Adobo")."""
    out = []
    for w in fold(text).split():
        like = f"%{w}%"
        out.append(
            or_(
                col(FoodItem.name).ilike(like),
                col(FoodItem.key).ilike(like),
                sa_cast(col(FoodItem.aliases), String).ilike(like),
            )
        )
    return out


def search_order(text: str) -> list[Any]:
    """A search's order: the household's own foods (theirs and Fern's)
    before database ones; among them the most recently eaten; then names
    that start with what was typed, the most trusted source, the most used,
    the shortest name."""
    starts = fold(text)
    return [
        _bulk_sql(),
        col(FoodItem.last_used_at).desc().nulls_last(),
        ~col(FoodItem.key).startswith(starts),
        tier_sql(),
        col(FoodItem.use_count).desc(),
        func.length(col(FoodItem.name)),
        col(FoodItem.name),
    ]


def own_or_used() -> Any:
    """The household's own foods and imported ones they have eaten."""
    bulk = _bulk_sql()
    return or_(~bulk, col(FoodItem.use_count) > 0)


def search_foods(ctx: Ctx, query: str, limit: int = 15) -> list[FoodItem]:
    """Library foods sharing a word with ``query``, best answer first
    (``rank_foods``); with no query, the household's own and eaten foods,
    most used first."""
    if not _words(query):
        return owned_repo.list_rows(
            ctx,
            FoodItem,
            own_or_used(),
            order_by=[col(FoodItem.use_count).desc(), col(FoodItem.name)],
            limit=limit,
        )
    return rank_foods(query, _candidates(ctx, [query]))[:limit]


def factor(food: FoodItem, qty: float, unit: str) -> float | None:
    """How many of the food's ``basis`` units ``qty`` ``unit`` is, or None
    when the two cannot be related (grams of a per-piece food with no piece
    weight)."""
    u = unit.strip().lower()
    # "serving (2 slices)", "sachet (30g)": the unit is its first word. One
    # that starts with a number ("30g") is a weight, read by item_grams.
    if u[:1].isalpha() and u not in GRAM_UNITS:
        u = re.findall(r"[a-z]+", u)[0]
    if qty <= 0:
        return None
    if u in GRAM_UNITS:
        if food.basis == "100g":
            return qty / 100
        return qty / food.unit_grams if food.unit_grams else None
    if u in COUNT_UNITS or fold(u) in food.key:
        if food.basis == "100g":
            return qty * food.unit_grams / 100 if food.unit_grams else None
        return qty
    return None


def scaled(food: FoodItem, qty: float, unit: str) -> dict[str, float] | None:
    """The food's nutrients for ``qty`` ``unit``, or None when they cannot
    be scaled."""
    k = factor(food, qty, unit)
    if k is None:
        return None
    out: dict[str, float] = {}
    for n in NUTRIENTS:
        v = getattr(food, n)
        if v is not None:
            out[n] = round(float(v) * k, 1)
    return out


def item_grams(it: dict[str, Any]) -> float | None:
    """The weight an item states: its ``grams``, or "N g" in its unit or
    name."""
    if it.get("grams"):
        return float(it["grams"])
    for text in (str(it.get("unit") or ""), str(it.get("name") or "")):
        m = _SAID_GRAMS.search(text)
        if m and float(m.group(1)) > 0:
            return float(m.group(1))
    return None


def _library_match(
    ctx: Ctx, it: dict[str, Any], rows: list[FoodItem]
) -> tuple[FoodItem, dict[str, float]] | None:
    """The library food that replaces this item's nutrition, with its
    values scaled to the item's amount, or None."""
    food, exact = match_food(ctx, str(it.get("name", "")), rows)
    values = (
        scaled(food, float(it.get("qty") or 1), str(it.get("unit") or ""))
        if food
        else None
    )
    if food is not None and values is None and (grams := item_grams(it)):
        # Seen live 2026-10-22 to 11-04: 39 of Kai's items named a library
        # food and kept the model's guess, because "1 serving" or "1 cup"
        # of a per-100 g food could not be scaled; their weight was known.
        values = scaled(food, grams, "g")
    # A match by shared words only ("pre-workout energy drink" against
    # the alias "pre workout drink" of a 489 kcal shake) is a guess: when
    # the item's own numbers (often read off a label in this very turn)
    # say something else, they stand.
    if (
        food is None
        or values is None
        or (not exact and it.get("kcal") is not None and not _agrees(it, values))
    ):
        return None
    return food, values


def library_hits(ctx: Ctx, items: list[dict[str, Any]]) -> list[bool]:
    """Which items ``apply_library`` would take from the library. Reads
    only: nothing is counted as used."""
    rows = _candidates_each(ctx, [str(it.get("name", "")) for it in items])
    return [bool(rows) and _library_match(ctx, it, rows) is not None for it in items]


def library_candidates(
    ctx: Ctx, items: list[dict[str, Any]], limit: int = 3
) -> list[dict[str, Any]]:
    """Each item the library does not replace whose name and a library
    food's name (or alias) are one inside the other ("rice" and "White
    rice, long-grain, cooked"), with up to ``limit`` such foods, most used
    first. Reads only."""
    rows = _candidates_each(ctx, [str(it.get("name", "")) for it in items])
    out: list[dict[str, Any]] = []
    for it in items:
        if not rows or _library_match(ctx, it, rows) is not None:
            continue
        name = str(it.get("name", ""))
        said = _words(name)
        near = [
            r
            for r in rows
            if said
            and any(
                (w := _words(n)) and (w <= said or said <= w)
                for n in [r.key, *(r.aliases or [])]
            )
        ]
        if near:
            near = rank_foods(name, near)
            out.append(
                {
                    "item": it.get("name"),
                    "library_foods": [food_public(r) for r in near[:limit]],
                }
            )
    return out


def apply_library(
    ctx: Ctx, items: list[dict[str, Any]]
) -> tuple[list[dict[str, Any]], list[str]]:
    """Meal items with their nutrition taken from the library where a food
    matches and the amount can be scaled; the rest unchanged. Returns the
    items and the names of the library foods used (each one's use is
    counted). Flushes only."""
    rows = _candidates_each(ctx, [str(it.get("name", "")) for it in items])
    if not rows:
        return items, []
    used: list[str] = []
    out: list[dict[str, Any]] = []
    for it in items:
        hit = _library_match(ctx, it, rows)
        if hit is None:
            out.append(it)
            continue
        food, values = hit
        # The library wins for every nutrient it knows; one it doesn't know
        # keeps the item's own estimate. Seen live 2026-11-02: saved foods
        # with calories and macros only wiped the sugar, sodium and
        # saturated fat of every meal that named them.
        said = (
            f"From {SOURCE_LABEL[food.source]} (food library): {food.name}"
            if is_bulk(food)
            else f"From your food library: {food.name}"
        )
        grams = item_grams(it)
        if grams and str(it.get("unit") or "").strip().lower() not in GRAM_UNITS:
            said += f", about {grams:g} g"
        out.append(it | values | {"assumption": said})
        food.use_count = (food.use_count or 0) + 1
        food.last_used_at = ctx.now
        ctx.session.add(food)
        used.append(food.name)
    if used:
        ctx.session.flush()
    return out, used


def food_public(f: FoodItem) -> dict[str, Any]:
    """A library food as a tool or screen shows it."""
    return (
        {
            "id": str(f.id),
            "name": f.name,
            "basis": {
                "100g": "per 100 g",
                "piece": "per piece",
                "serving": "per serving",
            }[f.basis],
            "unit_grams": f.unit_grams,
            "state": f.state,
            **{n: getattr(f, n) for n in NUTRIENTS if getattr(f, n) is not None},
            "aliases": f.aliases or [],
            "source": f.source,
            "verified": f.verified,
        }
        | ({"from": SOURCE_LABEL[f.source]} if is_bulk(f) else {})
        | ({"built_in": True} if f.is_global else {})
    )


# What a person can change on a saved food.
EDITABLE = (
    "name",
    "basis",
    "unit_grams",
    "state",
    "aliases",
    "notes",
    "photo_media_id",
    *NUTRIENTS,
)


def update_food(ctx: Ctx, food_id: uuid.UUID, changes: dict[str, Any]) -> FoodItem:
    """Change a saved food's name, basis, aliases, notes, photo or numbers;
    a new name becomes its new key. Only the caller's own foods change (a
    built-in one is refused, 403 ``catalog_read_only``); a name another of
    the caller's own live foods has is refused (409 ``food_name_taken``); a
    built-in food's name is free to use. Flushes only."""
    row = owned_repo.require_writable(ctx, FoodItem, food_id, what="food")
    data = {k: v for k, v in changes.items() if k in EDITABLE}
    if "name" in data:
        key = fold(str(data["name"]))
        if not key:
            raise ValueError("a food needs a name")
        if owned_repo.list_rows(
            ctx,
            FoodItem,
            col(FoodItem.key) == key[:160],
            col(FoodItem.id) != row.id,
            col(FoodItem.owner_id) == ctx.user_id,
            col(FoodItem.is_global).is_(False),
            limit=1,
        ):
            raise conflict("food_name_taken", "Another food already has that name")
        data["name"] = str(data["name"]).strip()[:160]
        data["key"] = key[:160]
    if data.get("photo_media_id") is not None:
        media_public.require_ready(ctx, data["photo_media_id"])
    if "aliases" in data:
        data["aliases"] = sorted({fold(a) for a in data["aliases"] if fold(a)})
    owned_repo.apply(row, data)
    ctx.session.add(row)
    ctx.session.flush()
    return row


def delete_food(ctx: Ctx, food_id: uuid.UUID) -> None:
    owned_repo.soft_delete(
        ctx, owned_repo.require_writable(ctx, FoodItem, food_id, what="food")
    )


def restore_food(ctx: Ctx, food_id: uuid.UUID) -> None:
    owned_repo.restore(
        ctx,
        owned_repo.require_writable(
            ctx, FoodItem, food_id, what="food", include_deleted=True
        ),
    )


def _free_name(ctx: Ctx, name: str) -> str:
    """``name``, or "``name`` (copy)", "(copy 2)", ...: the first one none
    of the caller's own live foods has."""
    base = name.strip()
    names = [base[:160], f"{base[:150]} (copy)"]
    names += [f"{base[:148]} (copy {n})" for n in range(2, 100)]
    for candidate in names:
        if not owned_repo.list_rows(
            ctx,
            FoodItem,
            col(FoodItem.key) == fold(candidate)[:160],
            col(FoodItem.owner_id) == ctx.user_id,
            col(FoodItem.is_global).is_(False),
            limit=1,
        ):
            return candidate
    raise conflict("food_name_taken", "You already have too many copies of that food")


# Copied onto the caller's own food; ``external_ref`` is not (a copy is the
# caller's, never a database row an import would rewrite).
_COPIED = (
    "basis",
    "unit_grams",
    "state",
    "aliases",
    *NUTRIENTS,
    "source",
    "source_url",
    "barcode",
    "notes",
    "photo_media_id",
    "verified",
)


def copy_food(ctx: Ctx, food_id: uuid.UUID) -> FoodItem:
    """A food of the caller's own with the numbers of any food they can see
    (a built-in one, typically, to customise). It keeps the name when none
    of the caller's own foods has it, else gains " (copy)" (then
    " (copy 2)", ...). Flushes only."""
    src = owned_repo.require(ctx, FoodItem, food_id, what="food")
    name = _free_name(ctx, src.name)
    values = {k: getattr(src, k) for k in _COPIED}
    # A renamed copy drops the aliases, so "rice" still finds one food.
    values["aliases"] = list(src.aliases or []) if name == src.name.strip() else []
    return owned_repo.insert(
        ctx, FoodItem, values | {"name": name, "key": fold(name)[:160]}
    )


def count_foods(ctx: Ctx) -> int:
    return owned_repo.count_rows(ctx, FoodItem, col(FoodItem.deleted_at).is_(None))


NOTION_BASIS = {"per 100 g": "100g", "per piece": "piece", "per serving": "serving"}
NOTION_STATE = {"raw": "raw", "cooked": "cooked", "as-sold": "as_sold"}
NOTION_SOURCE = {
    "Label": "label",
    "Brand/Chain": "brand",
    "PhilFCT": "philfct",
    "USDA FDC": "usda",
    "Recipe calc": "recipe",
}


def _num(v: Any) -> float | None:
    return None if v in (None, "") else float(v)


def draft_from_notion(row: dict[str, Any]) -> FoodDraft:
    """One row of the Macro Tracker's Notion "Food Library" as a food: its
    columns map one to one, and its page URL keys the import."""
    return FoodDraft(
        name=str(row["Food"]).strip(),
        kcal=float(row.get("kcal") or 0),
        protein=float(row.get("Protein g") or 0),
        carbs=float(row.get("Carbs g") or 0),
        fat=float(row.get("Fat g") or 0),
        fiber=_num(row.get("Fiber g")),
        sat_fat=_num(row.get("Sat fat g")),
        sugar=_num(row.get("Added sugar g")),
        sodium=_num(row.get("Sodium mg")),
        basis=NOTION_BASIS.get(str(row.get("Basis") or ""), "100g"),
        unit_grams=_num(row.get("Unit grams")),
        state=NOTION_STATE.get(str(row.get("State") or "")),
        aliases=[
            a.strip() for a in str(row.get("Aliases") or "").split(",") if a.strip()
        ],
        source=NOTION_SOURCE.get(str(row.get("Source type") or ""), "import"),
        source_url=row.get("Source URL") or None,
        external_ref=str(row["url"]) if row.get("url") else None,
        notes=(str(row["Notes"])[:500] if row.get("Notes") else None),
        verified=row.get("Verified") == "__YES__",
    )


def import_notion_rows(ctx: Ctx, rows: list[dict[str, Any]]) -> dict[str, int]:
    """Bring the Notion Food Library in: new foods are added, ones imported
    before (same page) are updated. Flushes only."""
    added = updated = 0
    for r in rows:
        _, new = save_food(ctx, draft_from_notion(r))
        added += new
        updated += not new
    return {"added": added, "updated": updated}
