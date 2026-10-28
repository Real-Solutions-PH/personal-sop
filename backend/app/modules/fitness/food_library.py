"""The person's own food library (``FoodItem``): saving a food's nutrition,
finding it again by name, and scaling it to the amount eaten.

Meal logging checks the library first, so a food read once from its label
gives the same numbers every time; only foods it has never seen fall back to
an estimate. Matching is by folded name or alias, then by every word of the
food's name appearing in what was said ("2 eggs" finds "Egg, whole,
hard-boiled" only through an alias, never by guesswork on one word)."""

import re
import uuid
from dataclasses import dataclass, field
from typing import Any

from sqlmodel import col

from app.modules.fitness.models import FoodItem
from app.shared import owned_repo
from app.shared.context import Ctx

NUTRIENTS = ("kcal", "protein", "carbs", "fat", "fiber", "sat_fat", "sugar", "sodium")
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
}
GRAM_UNITS = {"g", "gram", "grams", "gm", "gms"}
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
    sugar: float | None = None
    sodium: float | None = None
    basis: str = "100g"
    unit_grams: float | None = None
    state: str | None = None
    aliases: list[str] = field(default_factory=list)
    source: str = "said"
    source_url: str | None = None
    external_ref: str | None = None
    notes: str | None = None
    verified: bool = False


def _live(ctx: Ctx) -> list[FoodItem]:
    return owned_repo.list_rows(ctx, FoodItem)


def save_food(ctx: Ctx, d: FoodDraft) -> tuple[FoodItem, bool]:
    """Add a food, or update the one with the same name (or the same import
    source). Returns the row and whether it was new. Flushes only."""
    key = fold(d.name)
    if not key:
        raise ValueError("a food needs a name")
    rows = _live(ctx)
    row = next(
        (r for r in rows if d.external_ref and r.external_ref == d.external_ref),
        None,
    ) or next((r for r in rows if r.key == key), None)
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
        "sugar": d.sugar,
        "sodium": d.sodium,
        "source": d.source,
        "source_url": d.source_url,
        "external_ref": d.external_ref,
        "notes": d.notes,
        "verified": d.verified,
    }
    if row is None:
        return owned_repo.insert(ctx, FoodItem, values | {"aliases": aliases}), True
    # Keep aliases learned earlier; the new values replace the old ones.
    merged = sorted(set(row.aliases or []) | set(aliases))
    for k, v in values.items():
        setattr(row, k, v)
    row.aliases = merged
    ctx.session.add(row)
    ctx.session.flush()
    return row, False


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
    rows = _live(ctx) if rows is None else rows
    for r in rows:
        if r.key == key or key in (r.aliases or []):
            return r, True
    said = _words(name)
    best: tuple[int, FoodItem] | None = None
    for r in rows:
        for cand in [r.key, *(r.aliases or [])]:
            words = _words(cand)
            if words and words <= said and (best is None or len(words) > best[0]):
                best = (len(words), r)
    return (best[1], False) if best else (None, False)


def _agrees(item: dict[str, Any], values: dict[str, Any]) -> bool:
    """The item's own calories are near the library's for the same amount
    (within a third, or 40 kcal for small foods)."""
    mine, theirs = float(item.get("kcal") or 0), float(values.get("kcal") or 0)
    return abs(mine - theirs) <= max(40.0, theirs / 3)


def search_foods(ctx: Ctx, query: str, limit: int = 15) -> list[FoodItem]:
    """Library foods sharing a word with ``query`` (all of them when it is
    empty), most used first."""
    rows = _live(ctx)
    words = _words(query)
    if words:
        rows = [
            r
            for r in rows
            if words & (_words(r.key) | {w for a in r.aliases or [] for w in _words(a)})
        ]
    rows.sort(key=lambda r: (-(r.use_count or 0), r.name))
    return rows[:limit]


def factor(food: FoodItem, qty: float, unit: str) -> float | None:
    """How many of the food's ``basis`` units ``qty`` ``unit`` is, or None
    when the two cannot be related (grams of a per-piece food with no piece
    weight)."""
    u = unit.strip().lower()
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
    rows = _live(ctx)
    return [bool(rows) and _library_match(ctx, it, rows) is not None for it in items]


def apply_library(
    ctx: Ctx, items: list[dict[str, Any]]
) -> tuple[list[dict[str, Any]], list[str]]:
    """Meal items with their nutrition taken from the library where a food
    matches and the amount can be scaled; the rest unchanged. Returns the
    items and the names of the library foods used (each one's use is
    counted). Flushes only."""
    rows = _live(ctx)
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
        out.append(
            {k: v for k, v in it.items() if k not in NUTRIENTS}
            | values
            | {"assumption": f"From your food library: {food.name}"}
        )
        food.use_count = (food.use_count or 0) + 1
        food.last_used_at = ctx.now
        ctx.session.add(food)
        used.append(food.name)
    if used:
        ctx.session.flush()
    return out, used


def food_public(f: FoodItem) -> dict[str, Any]:
    """A library food as a tool or screen shows it."""
    return {
        "id": str(f.id),
        "name": f.name,
        "basis": {"100g": "per 100 g", "piece": "per piece", "serving": "per serving"}[
            f.basis
        ],
        "unit_grams": f.unit_grams,
        "state": f.state,
        **{n: getattr(f, n) for n in NUTRIENTS if getattr(f, n) is not None},
        "aliases": f.aliases or [],
        "source": f.source,
        "verified": f.verified,
    }


# What a person can change on a saved food.
EDITABLE = ("name", "basis", "unit_grams", "state", "aliases", *NUTRIENTS)


def update_food(ctx: Ctx, food_id: uuid.UUID, changes: dict[str, Any]) -> FoodItem:
    """Change a saved food's name, basis, aliases or numbers; a new name
    becomes its new key. Flushes only."""
    row = owned_repo.require(ctx, FoodItem, food_id, what="food")
    data = {k: v for k, v in changes.items() if k in EDITABLE}
    if "name" in data:
        key = fold(str(data["name"]))
        if not key:
            raise ValueError("a food needs a name")
        data["name"] = str(data["name"]).strip()[:160]
        data["key"] = key[:160]
    if "aliases" in data:
        data["aliases"] = sorted({fold(a) for a in data["aliases"] if fold(a)})
    owned_repo.apply(row, data)
    ctx.session.add(row)
    ctx.session.flush()
    return row


def delete_food(ctx: Ctx, food_id: uuid.UUID) -> None:
    owned_repo.soft_delete(ctx, owned_repo.require(ctx, FoodItem, food_id, what="food"))


def restore_food(ctx: Ctx, food_id: uuid.UUID) -> None:
    owned_repo.restore(
        ctx,
        owned_repo.require(ctx, FoodItem, food_id, what="food", include_deleted=True),
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
