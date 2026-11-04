"""The AI estimate behind "Describe your meal" (``meal_ai``).

The model is substituted at ``meal_ai.ask`` (its one call) and the model
lookup at ``meal_ai._resolve``. Expected numbers are written out by hand
from the stub answers and 4/4/9 Atwater energy, never computed by the
module under test.
"""

import json
from typing import Any

import pytest

from app.modules.fitness import foods as F
from app.modules.fitness import meal_ai

CTX: Any = object()  # never read: both seams that use it are stubbed


def _answer(*items: dict[str, Any], confidence: float = 0.8) -> str:
    return json.dumps({"items": list(items), "confidence": confidence})


# A described lunch the food table only half reads: it knows rice, drops
# the fried chicken without a word, and reads "eggplant" as a fried egg.
LUNCH = "1 cup rice, 1 pc fried chicken thigh, eggplant salad"
CHICKEN = {
    "name": "Fried chicken thigh",
    "qty": 1,
    "unit": "pc",
    "grams": 120,
    "kcal": 320,
    "protein": 26,
    "carbs": 8,
    "fat": 20,
    "assumption": "1 breaded thigh with skin",
}
RICE = {
    "name": "Steamed rice",
    "qty": 1,
    "unit": "cup",
    "grams": 160,
    "kcal": 205,
    "protein": 4,
    "carbs": 45,
    "fat": 0.5,
}
EGGPLANT = {
    "name": "Ensaladang talong",
    "qty": 1,
    "unit": "cup",
    "grams": 150,
    "kcal": 60,
    "protein": 2,
    "carbs": 10,
    "fat": 1.5,
}


class Model:
    """The prompts sent, and the replies scripted for the next calls."""

    def __init__(self) -> None:
        self.sent: list[str] = []
        self.answers: list[str | None] = []

    def ask(self, _ctx: Any, _resolved: Any, text: str) -> str | None:
        self.sent.append(text)
        return self.answers.pop(0) if self.answers else None


@pytest.fixture
def model(monkeypatch: pytest.MonkeyPatch) -> Model:
    m = Model()
    monkeypatch.setattr(meal_ai, "_resolve", lambda _ctx: object())
    monkeypatch.setattr(meal_ai, "ask", m.ask)
    return m


def test_the_food_table_drops_foods_it_does_not_know() -> None:
    """Why the model is needed: the table's reading of the same lunch."""
    est = F.parse_meal_text(LUNCH)
    assert est is not None
    assert sorted(i.name for i in est.items) == ["Fried egg", "Steamed rice"]


def test_every_food_named_is_kept_with_its_detail(model: Model) -> None:
    model.answers.extend([_answer(RICE, CHICKEN, EGGPLANT)])
    est = meal_ai.estimate(CTX, LUNCH)
    assert est is not None
    assert [i.name for i in est.items] == [
        "Steamed rice",
        "Fried chicken thigh",
        "Ensaladang talong",
    ]
    assert sum(i.kcal for i in est.items) == 205 + 320 + 60
    chicken = est.items[1]
    assert chicken.assumption == "1 breaded thigh with skin, about 120 g"
    assert est.confidence == pytest.approx(0.8)
    assert len(model.sent) == 1 and model.sent[0].endswith("Meal: " + LUNCH)


def test_a_wrong_item_is_sent_back_once(model: Model) -> None:
    # 26 g protein, 8 g carbs, 20 g fat is 4*26 + 4*8 + 9*20 = 316 kcal,
    # not 150: the model is told and answers again.
    bad = CHICKEN | {"kcal": 150}
    model.answers.extend([_answer(RICE, bad), _answer(RICE, CHICKEN)])
    est = meal_ai.estimate(CTX, "rice and fried chicken")
    assert est is not None
    assert [i.kcal for i in est.items] == [205, 320]
    assert len(model.sent) == 2
    assert "kcal_does_not_match_macros" in model.sent[1]
    assert est.confidence == pytest.approx(meal_ai.REPAIRED_CONFIDENCE)


def test_calories_still_wrong_after_the_repair_take_the_atwater_value(
    model: Model,
) -> None:
    bad = CHICKEN | {"kcal": 150}
    model.answers.extend([_answer(bad), _answer(bad)])
    est = meal_ai.estimate(CTX, "fried chicken")
    assert est is not None
    assert est.items[0].kcal == 316
    assert est.confidence == pytest.approx(meal_ai.SETTLED_CONFIDENCE)


def test_a_weighed_item_carries_its_weight_as_its_amount(model: Model) -> None:
    # 200 g of grilled chicken breast (USDA 171140, roasted: 165 kcal,
    # 31 g protein, 3.6 g fat per 100 g) sent back as qty 1.
    breast = {
        "name": "Grilled chicken breast",
        "qty": 1,
        "unit": "g",
        "grams": 200,
        "kcal": 330,
        "protein": 62,
        "carbs": 0,
        "fat": 7.2,
    }
    model.answers.extend([_answer(breast)])
    est = meal_ai.estimate(CTX, "200g grilled chicken breast")
    assert est is not None
    assert (est.items[0].qty, est.items[0].unit, est.items[0].kcal) == (200, "g", 330)


def test_nothing_usable_falls_back_to_the_table(model: Model) -> None:
    model.answers.extend(["I could not tell what that is."])
    assert meal_ai.estimate(CTX, "rice and adobo") is None


def test_no_model_falls_back_to_the_table(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(meal_ai, "_resolve", lambda _ctx: None)

    def never(*_a: Any) -> str:
        raise AssertionError("no model was resolved")

    monkeypatch.setattr(meal_ai, "ask", never)
    assert meal_ai.estimate(CTX, "rice and adobo") is None


def test_an_invalid_item_is_dropped_not_the_meal(model: Model) -> None:
    model.answers.extend([_answer(RICE, {"name": "", "kcal": -5})])
    est = meal_ai.estimate(CTX, "rice")
    assert est is not None and [i.name for i in est.items] == ["Steamed rice"]


def test_thinking_before_the_json_is_ignored(model: Model) -> None:
    model.answers.extend(['<think>{"items": "maybe"}</think>Here: ' + _answer(RICE)])
    est = meal_ai.estimate(CTX, "rice")
    assert est is not None and est.items[0].kcal == 205


# A described meal seen live (2026-11): a weight worked out as a sum in the
# box, a misspelt dish, and 100 g of soup. The food table read the soup as
# 100 bowls of pork sinigang (32,000 kcal) and the chicken as 27 g.
SEEN = "209+25-27g chicken breast meat sinigagn, 100g sinigang soup"
# USDA FoodData Central 171477 (chicken breast, meat only, roasted): 165
# kcal, 31.0 g protein, 3.6 g fat per 100 g; 207 g is about 342 kcal, 64 g
# protein, 7.5 g fat. Clear sinigang broth: about 10-25 kcal per 100 g.
SEEN_CHICKEN = {
    "name": "Chicken breast meat (sinigang)",
    "qty": 207,
    "unit": "g",
    "grams": 207,
    "kcal": 342,
    "protein": 64,
    "carbs": 0,
    "fat": 7.5,
}
SEEN_BROTH = {
    "name": "Sinigang broth",
    "qty": 100,
    "unit": "g",
    "grams": 100,
    "kcal": 15,
    "protein": 1,
    "carbs": 2.5,
    "fat": 0.3,
}


def test_a_sum_in_the_box_is_added_up_before_the_model_reads_it(
    model: Model,
) -> None:
    model.answers.extend([_answer(SEEN_CHICKEN, SEEN_BROTH)])
    est = meal_ai.estimate(CTX, SEEN)
    assert model.sent[0].endswith(
        "Meal: 207g chicken breast meat sinigagn, 100g sinigang soup"
    )
    assert est is not None
    assert [(i.qty, i.unit) for i in est.items] == [(207, "g"), (100, "g")]
    assert sum(i.kcal for i in est.items) == 357


def test_the_table_reads_the_same_meal_within_bounds() -> None:
    """The offline fallback: the weight is the sum, and grams on a food
    served in bowls are one bowl, never a hundred."""
    est = F.parse_meal_text(SEEN)
    assert est is not None
    got = {i.name: (i.qty, i.unit, i.kcal) for i in est.items}
    # 207 g of the table's 150 g breast (260 kcal): 260 * 207 / 150 = 358.8.
    assert got["Chicken inasal (breast)"] == (207, "g", 359)
    assert got["Sinigang na baboy"] == (1, "bowl", 320)


@pytest.mark.parametrize(
    ("said", "read"),
    [
        ("209+25-27g chicken", "207g chicken"),
        ("1.5+0.5 cups rice", "2 cups rice"),
        ("2-3 eggs", "2-3 eggs"),  # a range, not a sum
        ("10+2.5 g", "12.5 g"),
        ("5-10+1 pcs", "5-10+1 pcs"),  # adds up below zero: left as said
    ],
)
def test_add_up_amounts(said: str, read: str) -> None:
    assert F.add_up_amounts(said) == read
