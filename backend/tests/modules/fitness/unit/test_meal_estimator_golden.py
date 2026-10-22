"""The deterministic meal estimator (``foods.py``) against the prototype."""

from dataclasses import asdict
from typing import Any

from app.modules.fitness import foods as F
from tests.modules.fitness.unit.golden import load

FX = load("fitness-meal-estimator")["data"]


def _item(it: F.ItemDraft) -> dict[str, Any]:
    out = asdict(it)
    # Optional fields the prototype's items never carry (an unset
    # assumption, and nutrient detail the food table does not have).
    for key in ("assumption", "fiber", "sat_fat", "sugar", "sodium"):
        if out[key] is None:
            del out[key]
    return out


def test_food_table_has_every_prototype_food() -> None:
    assert len(F.FOODS) == 26
    assert len({f.key for f in F.FOODS}) == 26


def test_parse_meal_text_cases() -> None:
    assert len(FX["cases"]) > 25
    hits = 0
    for c in FX["cases"]:
        got = F.parse_meal_text(c["raw"])
        want = c["result"]
        if want is None:
            assert got is None, c["raw"]
            continue
        hits += 1
        assert got is not None, c["raw"]
        assert [_item(i) for i in got.items] == want["items"], c["raw"]
        assert got.confidence == want["confidence"], c["raw"]
        fu = got.follow_up.as_dict() if got.follow_up else None
        assert fu == want["followUp"], c["raw"]
    assert hits > 20


def test_answer_follow_up() -> None:
    meal = FX["answers"]
    for c in meal:
        items = [
            F.ItemDraft(
                name="Steamed rice",
                qty=1,
                unit="cup",
                kcal=205,
                protein=4,
                carbs=45,
                fat=0,
                assumption="~1 cup cooked, 160 g",
            ),
            F.ItemDraft(
                name="Garlic rice (sinangag)",
                qty=1.5,
                unit="cup",
                kcal=420,
                protein=8,
                carbs=75,
                fat=9,
            ),
            F.ItemDraft(
                name="Chicken adobo (thigh)",
                qty=2,
                unit="pc",
                kcal=380,
                protein=32,
                carbs=4,
                fat=26,
            ),
        ]
        got = F.answer_follow_up(items, c["confidenceIn"], c["option"])
        assert got.confidence == c["confidence"], c["option"]
        want = [{k: v for k, v in i.items() if k != "id"} for i in c["items"]]
        assert [_item(i) for i in got.items] == want, c["option"]
        assert c["followUp"] is None


def test_scale_item_quantity_edits() -> None:
    base = {
        "r": F.ItemDraft(
            "Steamed rice", 1, "cup", 205, 4, 45, 0, "~1 cup cooked, 160 g"
        ),
        "g": F.ItemDraft("Garlic rice (sinangag)", 1.5, "cup", 420, 8, 75, 9),
        "a": F.ItemDraft("Chicken adobo (thigh)", 2, "pc", 380, 32, 4, 26),
    }
    for c in FX["qty"]:
        got = F.scale_item(base[c["itemId"]], max(0, c["qty"]))
        want = {k: v for k, v in c["item"].items() if k != "id"}
        assert _item(got) == want, c
