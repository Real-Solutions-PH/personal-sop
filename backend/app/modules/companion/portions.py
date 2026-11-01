"""Portion planner (Fern's ``portion_plan``): grams per food, computed here.

Asked "what should my portions be to hit my protein", the model gave grams
for the fish only and added up macros itself, differently each time
(2026-10-31). Here the model only names the foods (and, for a food the
library and the reference below don't know, its values per 100 g); the
grams, each food's macros, the meal total and what is left after it are
all worked out in :func:`plan`, which is pure.

How the grams are chosen, in order:

1. Foods with ``grams`` given are eaten as given.
2. Sides (vegetables, soups; under 80 kcal per 100 g) get 100 g each.
3. Protein foods split the protein still needed; each between 50 and 350 g.
4. ``extra`` foods (a protein shake) are added in whole servings, at most
   two, only while protein is still short by 5 g or more.
5. Carb foods split the calories still left; each at most 400 g, none when
   nothing is left.

The budget is what is left today, shared across the meals still ahead
(this one included) unless the model passes a target or ``whole_day``.
Grams are rounded to 5 g; totals add the per-food numbers before rounding.
"""

import math
import re
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any, Literal

MACROS = ("kcal", "protein", "carbs", "fat")
Role = Literal["protein", "carb", "side", "extra"]
SIDE_GRAMS = 100.0
PROTEIN_MIN_G, PROTEIN_MAX_G = 50.0, 350.0
CARB_MAX_G = 400.0
EXTRA_MAX_SERVINGS = 2
SHORT_ENOUGH_G = 5.0

# Edible, cooked values per 100 g for foods eaten every day here, used when
# neither the model nor the person's library gives values. Estimates, and
# said so (``source`` "standard").
REFERENCE: dict[str, tuple[float, float, float, float]] = {
    "white rice": (130, 2.7, 28.2, 0.3),
    "rice": (130, 2.7, 28.2, 0.3),
    "brown rice": (112, 2.3, 23.5, 0.8),
    "fried rice": (174, 4.0, 31.0, 3.5),
    "fried tilapia": (180, 24.0, 2.0, 8.5),
    "tilapia": (128, 26.2, 0.0, 2.7),
    "bangus": (190, 23.0, 0.0, 10.5),
    "chicken breast": (165, 31.0, 0.0, 3.6),
    "chicken thigh": (209, 26.0, 0.0, 10.9),
    "adobo": (215, 20.0, 3.0, 13.5),
    "pork": (242, 27.0, 0.0, 14.0),
    "beef": (250, 26.0, 0.0, 15.0),
    "egg": (143, 12.6, 0.7, 9.5),
    "tofu": (76, 8.0, 1.9, 4.8),
    "pinakbet": (75, 2.5, 8.0, 4.0),
    "monggo": (105, 7.0, 15.0, 2.0),
    "sinigang": (40, 3.5, 3.0, 1.5),
    "banana": (89, 1.1, 22.8, 0.3),
    "oatmeal": (71, 2.5, 12.0, 1.5),
    "bread": (265, 9.0, 49.0, 3.2),
    "pandesal": (290, 8.5, 54.0, 4.5),
    "sweet potato": (90, 2.0, 20.7, 0.2),
    "kamote": (90, 2.0, 20.7, 0.2),
    "pea protein": (370, 80.0, 6.0, 6.0),
    "whey": (390, 78.0, 9.0, 5.0),
}


@dataclass
class Food:
    name: str
    per100: dict[str, float]
    source: str
    role: Role
    grams: float | None = None
    serving_grams: float | None = None


@dataclass
class Portion:
    food: Food
    grams: float
    servings: int | None = None

    def macro(self, k: str) -> float:
        return self.food.per100.get(k, 0.0) * self.grams / 100


@dataclass
class Plan:
    portions: list[Portion] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)


def _words(s: str) -> set[str]:
    return {w for w in re.findall(r"[a-z]+", s.lower()) if len(w) > 2}


def reference(name: str) -> tuple[str, dict[str, float]] | None:
    """The reference food whose name shares the most words with ``name``
    (longest key first, so "fried tilapia" beats "tilapia")."""
    want = _words(name)
    best: tuple[int, int, str] | None = None
    for key in REFERENCE:
        k = _words(key)
        if k and k <= want:
            score = (len(k), len(key), key)
            best = max(best, score) if best else score
    if best is None:
        return None
    return best[2], dict(zip(MACROS, REFERENCE[best[2]], strict=True))


def infer_role(per100: dict[str, float]) -> Role:
    kcal = per100.get("kcal", 0.0)
    if kcal < 80:
        return "side"
    if kcal and per100.get("protein", 0.0) * 4 / kcal >= 0.45:
        return "protein"
    return "carb"


def _round5(g: float) -> float:
    return float(max(0, round(g / 5) * 5))


def plan(foods: list[Food], budget: dict[str, float]) -> Plan:
    """Grams for every food against ``budget`` (kcal and protein for this
    meal)."""
    out = Plan()
    chosen: dict[int, Portion] = {}

    def total(k: str) -> float:
        return sum(p.macro(k) for p in chosen.values())

    for i, f in enumerate(foods):
        if f.grams is not None:
            chosen[i] = Portion(f, f.grams)
    for i, f in enumerate(foods):
        if i not in chosen and f.role == "side":
            chosen[i] = Portion(f, SIDE_GRAMS)
    proteins = [
        i for i, f in enumerate(foods) if i not in chosen and f.role == "protein"
    ]
    need = max(0.0, budget.get("protein", 0.0) - total("protein"))
    for i in proteins:
        per_g = foods[i].per100.get("protein", 0.0) / 100
        g = need / len(proteins) / per_g if per_g else PROTEIN_MIN_G
        chosen[i] = Portion(
            foods[i], _round5(min(PROTEIN_MAX_G, max(PROTEIN_MIN_G, g)))
        )
    for i, f in enumerate(foods):
        if i in chosen or f.role != "extra":
            continue
        short = budget.get("protein", 0.0) - total("protein")
        serving = f.serving_grams or 30.0
        per_serving = f.per100.get("protein", 0.0) * serving / 100
        if short >= SHORT_ENOUGH_G and per_serving > 0:
            n = min(EXTRA_MAX_SERVINGS, math.ceil(short / per_serving))
            chosen[i] = Portion(f, serving * n, servings=n)
        else:
            out.notes.append(f"{f.name} not needed: protein is covered")
    carbs = [i for i, f in enumerate(foods) if i not in chosen and f.role == "carb"]
    room = budget.get("kcal", 0.0) - total("kcal")
    for i in carbs:
        per_g = foods[i].per100.get("kcal", 0.0) / 100
        g = room / len(carbs) / per_g if per_g and room > 0 else 0.0
        chosen[i] = Portion(foods[i], _round5(min(CARB_MAX_G, g)))
        if g <= 0:
            out.notes.append(f"no calories left for {foods[i].name}")
    out.portions = [chosen[i] for i in sorted(chosen) if chosen[i].grams > 0]
    short = budget.get("protein", 0.0) - total("protein")
    if short >= SHORT_ENOUGH_G:
        out.notes.append(f"protein still short by {round(short)} g")
    return out


def _n(x: float) -> float:
    return round(x, 1)


def result(
    p: Plan, *, budget: dict[str, float], left_before: dict[str, float] | None
) -> dict[str, Any]:
    """The tool's answer: the numbers the reply may use, all computed."""
    meal = {k: _n(sum(x.macro(k) for x in p.portions)) for k in MACROS}
    out: dict[str, Any] = {
        "portions": [
            {
                "food": x.food.name,
                "grams": x.grams,
                **({"servings": x.servings} if x.servings else {}),
                **{k: _n(x.macro(k)) for k in MACROS},
                "values_from": x.food.source,
            }
            for x in p.portions
        ],
        "meal_total": meal,
        "budget_for_this_meal": {k: _n(v) for k, v in budget.items()},
    }
    if left_before is not None:
        out["left_today_before"] = {k: _n(v) for k, v in left_before.items()}
        out["left_today_after"] = {
            k: _n(left_before.get(k, 0.0) - meal[k]) for k in MACROS if k in left_before
        }
    if p.notes:
        out["notes"] = p.notes
    return out


def table(out: dict[str, Any]) -> dict[str, Any]:
    """The plan as the chat's table block: one row per food, the meal total,
    and what is left today after it."""

    def num(v: Any) -> str:
        return f"{round(float(v)):,}"

    rows = [
        [
            str(x["food"])
            + (f" ({x['servings']} serving{'s' if x['servings'] > 1 else ''})"
               if x.get("servings") else ""),
            f"{num(x['grams'])} g",
            num(x["kcal"]),
            num(x["protein"]),
            num(x["carbs"]),
            num(x["fat"]),
        ]
        for x in out["portions"]
    ]  # fmt: skip
    meal = out["meal_total"]
    foot = [["Meal total", "", *(num(meal[k]) for k in MACROS)]]
    after = out.get("left_today_after")
    if after:
        foot.append(["Left today after", "", *(num(after.get(k, 0)) for k in MACROS)])
    return {
        "t": "table",
        "title": "Portions",
        "columns": ["Food", "Amount", "kcal", "Protein g", "Carbs g", "Fat g"],
        "rows": rows,
        "foot": foot,
        "note": "; ".join(
            sorted({f"{x['food']}: {x['values_from']}" for x in out["portions"]})
        ),
    }


# A shake or powder is topped up by the scoop, never sized like a fish.
_SUPPLEMENT = re.compile(r"\b(protein|whey|shake|scoop|powder|isolate)\b", re.I)

Lookup = Callable[[str], tuple[str, dict[str, float], float | None] | None]


def resolve(raw: list[dict[str, Any]], library: Lookup) -> tuple[list[Food], list[str]]:
    """Each food with values per 100 g: the model's own, else the person's
    library (``library`` returns name, per-100 g values and a serving's
    grams), else the reference. Returns the foods and the names nobody
    knows."""
    foods: list[Food] = []
    unknown: list[str] = []
    for r in raw:
        name = str(r["name"])
        given = {
            k: float(r[f"{k}_per_100g"])
            for k in MACROS
            if r.get(f"{k}_per_100g") is not None
        }
        serving = r.get("serving_grams")
        if "kcal" in given and "protein" in given:
            per100 = {k: given.get(k, 0.0) for k in MACROS}
            source = "your numbers" if r.get("from_person") else "estimate"
        elif (hit := library(name)) is not None:
            lname, per100, lserving = hit
            source = f"your library ({lname})"
            serving = serving or lserving
        elif (ref := reference(name)) is not None:
            per100 = ref[1]
            source = "standard values"
        else:
            unknown.append(name)
            continue
        role = r.get("role") or (
            "extra" if _SUPPLEMENT.search(name) else infer_role(per100)
        )
        foods.append(
            Food(
                name=name,
                per100=per100,
                source=source,
                role=role,
                grams=float(r["grams"]) if r.get("grams") else None,
                serving_grams=float(serving) if serving else None,
            )
        )
    return foods, unknown
