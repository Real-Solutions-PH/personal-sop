"""The built-in food table and the deterministic meal estimator.

A port of ``FOODS`` (``shared/prototype/fitness/data.ts``) and of
``parseMealText`` / ``answerFollowUp`` (``actions.ts``). This is what runs
when no AI model resolves for the user: it recognises Filipino staples by
alias, reads a quantity from the words just before each alias, and asks one
follow-up when rice is on the plate without an amount.
"""

import math
import re
from dataclasses import dataclass, replace

from app.modules.fitness.calc import js_round


@dataclass(frozen=True)
class Food:
    key: str
    name: str
    qty: float
    unit: str
    kcal: float
    protein: float
    carbs: float
    fat: float
    assumption: str
    aliases: tuple[str, ...]


FOODS: tuple[Food, ...] = (
    Food(
        "garlic-rice",
        "Garlic rice (sinangag)",
        1,
        "cup",
        280,
        5,
        50,
        6,
        "~1 cup, 180 g",
        ("garlic rice", "sinangag"),
    ),
    Food(
        "rice",
        "Steamed rice",
        1,
        "cup",
        205,
        4,
        45,
        0,
        "~1 cup cooked, 160 g",
        ("rice", "kanin"),
    ),
    Food("tapa", "Beef tapa", 100, "g", 250, 24, 8, 14, "~100 g, pan-fried", ("tapa",)),
    Food(
        "egg",
        "Fried egg",
        1,
        "pc",
        90,
        6,
        0,
        7,
        "1 large egg, fried in oil",
        ("egg", "itlog", "eggs"),
    ),
    Food(
        "adobo",
        "Chicken adobo (thigh)",
        2,
        "pc",
        380,
        32,
        4,
        26,
        "2 thigh pieces with sauce",
        ("adobo",),
    ),
    Food(
        "sinigang-baboy",
        "Sinigang na baboy",
        1,
        "bowl",
        320,
        22,
        10,
        21,
        "1 bowl, pork belly + kangkong, radish",
        ("sinigang",),
    ),
    Food(
        "sinigang-hipon",
        "Sinigang na hipon",
        1,
        "bowl",
        180,
        24,
        10,
        4,
        "1 bowl, ~8 shrimp",
        ("hipon", "shrimp"),
    ),
    Food(
        "tinola",
        "Chicken tinola",
        1,
        "bowl",
        240,
        28,
        8,
        10,
        "1 bowl, 2 pcs chicken + sayote",
        ("tinola",),
    ),
    Food(
        "pandesal", "Pandesal", 2, "pc", 240, 7, 44, 4, "2 medium pieces", ("pandesal",)
    ),
    Food(
        "coffee",
        "3-in-1 coffee",
        1,
        "sachet",
        70,
        1,
        12,
        2,
        "1 sachet with sugar & creamer",
        ("coffee", "kape"),
    ),
    Food(
        "longganisa",
        "Longganisa",
        3,
        "pc",
        330,
        15,
        12,
        25,
        "3 pcs sweet (hamonado)",
        ("longganisa",),
    ),
    Food("tocino", "Pork tocino", 100, "g", 290, 16, 22, 15, "~100 g", ("tocino",)),
    Food(
        "bangus",
        "Daing na bangus",
        0.5,
        "fish",
        280,
        30,
        0,
        17,
        "half a medium milkfish, fried",
        ("bangus", "milkfish"),
    ),
    Food(
        "pinakbet",
        "Pinakbet",
        1,
        "cup",
        150,
        6,
        14,
        8,
        "1 cup with bagoong",
        ("pinakbet",),
    ),
    Food(
        "monggo",
        "Ginisang monggo",
        1,
        "cup",
        220,
        14,
        30,
        5,
        "1 cup with malunggay",
        ("monggo", "munggo"),
    ),
    Food(
        "lechon-kawali",
        "Lechon kawali",
        100,
        "g",
        450,
        25,
        0,
        38,
        "~100 g, deep-fried pork belly",
        ("lechon", "kawali"),
    ),
    Food(
        "pancit",
        "Pancit canton",
        1,
        "plate",
        400,
        12,
        60,
        12,
        "1 plate, with veggies",
        ("pancit", "canton"),
    ),
    Food(
        "whey",
        "Whey protein",
        1,
        "scoop",
        120,
        24,
        3,
        2,
        "1 scoop (30 g) in water",
        ("whey", "protein shake", "shake"),
    ),
    Food(
        "banana",
        "Banana (lakatan)",
        1,
        "pc",
        100,
        1,
        26,
        0,
        "1 medium",
        ("banana", "saging"),
    ),
    Food(
        "oatmeal",
        "Oatmeal with milk",
        1,
        "cup",
        250,
        10,
        40,
        6,
        "1 cup cooked, low-fat milk",
        ("oatmeal", "oats"),
    ),
    Food(
        "inasal",
        "Chicken inasal (breast)",
        150,
        "g",
        260,
        46,
        2,
        7,
        "~150 g grilled breast, no skin",
        ("inasal", "grilled chicken", "chicken breast"),
    ),
    Food("turon", "Turon", 1, "pc", 180, 1, 30, 7, "1 piece", ("turon",)),
    Food(
        "nilaga",
        "Nilagang baka",
        1,
        "bowl",
        350,
        30,
        12,
        20,
        "1 bowl, beef shank + potato, pechay",
        ("nilaga",),
    ),
    Food(
        "tortang-talong",
        "Tortang talong",
        1,
        "pc",
        200,
        10,
        8,
        14,
        "1 eggplant omelette",
        ("talong", "torta"),
    ),
    Food(
        "skyflakes",
        "SkyFlakes crackers",
        1,
        "pack",
        130,
        3,
        19,
        5,
        "1 pack (25 g)",
        ("skyflakes", "crackers"),
    ),
    Food(
        "softdrink",
        "Softdrink",
        1,
        "can",
        140,
        0,
        39,
        0,
        "1 can, 330 ml, regular",
        ("softdrink", "softdrinks", "coke", "soda"),
    ),
)

_BY_KEY = {f.key: f for f in FOODS}


def food_by_key(key: str) -> Food | None:
    return _BY_KEY.get(key)


@dataclass(frozen=True)
class ItemDraft:
    name: str
    qty: float
    unit: str
    kcal: float
    protein: float
    carbs: float
    fat: float
    assumption: str | None = None


@dataclass(frozen=True)
class FollowUp:
    question: str
    options: tuple[str, ...]

    def as_dict(self) -> dict[str, object]:
        return {"question": self.question, "options": list(self.options)}


@dataclass(frozen=True)
class Estimate:
    items: list[ItemDraft]
    confidence: float
    follow_up: FollowUp | None = None


def item_from_food(f: Food, mult: float = 1) -> ItemDraft:
    return ItemDraft(
        name=f.name,
        qty=js_round(f.qty * mult * 100) / 100,
        unit=f.unit,
        kcal=js_round(f.kcal * mult),
        protein=js_round(f.protein * mult),
        carbs=js_round(f.carbs * mult),
        fat=js_round(f.fat * mult),
        assumption=f.assumption,
    )


def scale_item(it: ItemDraft, qty: float) -> ItemDraft:
    """Change an item's quantity; its macros scale proportionally."""
    f = qty / it.qty if it.qty > 0 else 1
    return replace(
        it,
        qty=qty,
        kcal=js_round(it.kcal * f),
        protein=js_round(it.protein * f),
        carbs=js_round(it.carbs * f),
        fat=js_round(it.fat * f),
    )


WORD_NUM: dict[str, float] = {
    "half": 0.5,
    "kalahati": 0.5,
    "one": 1,
    "isang": 1,
    "two": 2,
    "dalawang": 2,
    "three": 3,
    "tatlong": 3,
}

_SILOG = (
    ("tapsilog", "tapa, garlic rice, egg"),
    ("longsilog", "longganisa, garlic rice, egg"),
    ("tocilog", "tocino, garlic rice, egg"),
    ("bangsilog", "bangus, garlic rice, egg"),
)
# ``$`` in JavaScript (no ``m`` flag) is end of input: ``\Z`` in Python.
_NUM = re.compile(
    r"([0-9]+(?:\.[0-9]+)?)\s*(?:x|pcs?|cups?|scoops?|g|bowls?|plates?|cans?)?"
    r"\s*(?:na|of)?\s*\Z"
)
_WORD = re.compile(
    r"(half|kalahati|one|isang|two|dalawang|three|tatlong)\s*(?:cups?|na|of)?\s*\Z"
)
_RICE_GIVEN = re.compile(r"[0-9]|half|isang|kalahati")
# Every alias, longest first (a stable sort keeps table order within a length).
_ALIASES: tuple[tuple[str, Food], ...] = tuple(
    sorted(((a, f) for f in FOODS for a in f.aliases), key=lambda p: -len(p[0]))
)
RICE_FOLLOW_UP = FollowUp("How much rice?", ("1 cup", "1.5 cups", "2 cups"))


def parse_meal_text(raw: str) -> Estimate | None:
    """Itemise a free-text meal description, or ``None`` when nothing in it
    is a known food."""
    text = raw.lower()
    for short, long in _SILOG:
        text = text.replace(short, long)
    items: list[ItemDraft] = []
    used: set[str] = set()
    rest = text
    for alias, f in _ALIASES:
        i = rest.find(alias)
        if i < 0 or f.key in used:
            continue
        used.add(f.key)
        before = rest[max(0, i - 14) : i]
        num = _NUM.search(before)
        word = _WORD.search(before)
        qty_given: float | None = None
        if num:
            qty_given = float(num.group(1))
        elif word:
            qty_given = WORD_NUM[word.group(1)]
        mult = 1.0
        if qty_given is not None:
            if f.unit == "g":
                mult = qty_given / f.qty if qty_given > 20 else qty_given
            else:
                mult = qty_given / f.qty
        items.append(item_from_food(f, max(0.25, mult)))
        rest = rest[:i] + " " * len(alias) + rest[i + len(alias) :]
    if not items:
        return None
    rice_given = _RICE_GIVEN.search(text) is not None
    has_rice = "rice" in used or "garlic-rice" in used
    return Estimate(
        items=items,
        confidence=min(0.92, 0.6 + len(items) * 0.08),
        follow_up=RICE_FOLLOW_UP if has_rice and not rice_given else None,
    )


_FLOAT_PREFIX = re.compile(
    r"\s*([+-]?(?:[0-9]+\.?[0-9]*|\.[0-9]+)(?:[eE][+-]?[0-9]+)?)"
)


def parse_float(s: str) -> float:
    """``Number.parseFloat``: the leading number, or NaN."""
    m = _FLOAT_PREFIX.match(s)
    return float(m.group(1)) if m else math.nan


@dataclass(frozen=True)
class FollowUpAnswer:
    items: list[ItemDraft]
    confidence: float


_RICE = re.compile(r"rice", re.IGNORECASE)


def answer_follow_up(
    items: list[ItemDraft], confidence: float | None, option: str
) -> FollowUpAnswer:
    """Apply the answer to the rice follow-up: every rice item is rescaled to
    the stated cups (``"half"`` and anything unreadable count as 1) and the
    estimate's confidence rises by 0.1 (capped at 0.95)."""
    cups = parse_float(option)
    if math.isnan(cups) or cups == 0:
        cups = 1
    return FollowUpAnswer(
        items=[
            replace(scale_item(it, cups), assumption=f"{option}, you said")
            if _RICE.search(it.name)
            else it
            for it in items
        ],
        confidence=min(0.95, (0.7 if confidence is None else confidence) + 0.1),
    )
