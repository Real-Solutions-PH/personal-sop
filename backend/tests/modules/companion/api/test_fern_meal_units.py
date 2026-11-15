"""A meal item Fern weighs is shown in grams, and a weight never lands as a
count of servings.

Replays Kai's dinner of 2026-11-14 (production record, read-only): "150 g
of rice and 189 g of chicken andoks", then "43g chicken andoks". Fern sent
the extra chicken with ``grams`` and no unit, so it was saved as "1
serving"; resizing it later with ``qty`` 132 (meaning grams) left the
review screen reading "132 serving" beside a note that said 70 g.
"""

from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session

from app.modules.capture.fitness_tools import weighed
from app.modules.fitness.models import MealItem
from tests.modules.capture.api.helpers import Api
from tests.modules.companion.api.test_fern_agent import act, live, rows_of, undo
from tests.modules.companion.api.test_fern_fitness import fern, tool_result, turn

CHICKEN = "Andok's Litson Manok (roast chicken, with skin)"
# The 70 g portion Fern sent on 2026-11-14 (its edit_meal add_items entry).
SEVENTY: dict[str, Any] = {
    "name": CHICKEN,
    "grams": 70,
    "kcal": 156,
    "protein": 16.4,
    "carbs": 0,
    "fat": 9.9,
    "sat_fat": 2.8,
    "fiber": 0,
    "fiber_soluble": 0,
    "fiber_insoluble": 0,
    "sugar": 0,
    "sodium": 150,
    "assumption": "70 g edible, with skin · same per-100 g basis as the "
    "Andok's chicken already in dinner",
}
# The values Fern meant for the 132 g dinner chicken.
FOR_132 = {"kcal": 294, "protein": 30.9, "carbs": 0, "fat": 18.7}


def _dinner(api: Api, chicken: dict[str, Any]) -> str:
    meal: dict[str, Any] = api.post(
        "/fitness/meals",
        {
            "label": "dinner",
            "raw_input": "Rice and Andok's chicken",
            "items": [
                {
                    "name": "White rice, long-grain, cooked",
                    "qty": 150,
                    "unit": "g",
                    "kcal": 195,
                    "protein": 4,
                    "carbs": 42.3,
                    "fat": 0.4,
                },
                chicken,
            ],
        },
    )
    return str(meal["id"])


def _chicken(api: Api) -> list[MealItem]:
    return [i for i in live(rows_of(api, MealItem)) if i.name == CHICKEN]


# The chicken as it was stored on 2026-11-14 before the bad edit.
SERVING_CHICKEN = {
    "name": CHICKEN,
    "qty": 1,
    "unit": "serving",
    "kcal": 156,
    "protein": 16.4,
    "carbs": 0,
    "fat": 9.9,
    "assumption": SEVENTY["assumption"] + ", about 70 g",
}


def test_a_weight_sent_without_a_unit_is_saved_in_grams() -> None:
    sent = {"name": CHICKEN, "qty": 1, "unit": "serving", "kcal": 156}
    assert weighed(sent, 70, unit_said=False) == sent | {"qty": 70, "unit": "g"}
    # A unit the model chose stays: "2 pieces" weighing 140 g is still 2 pieces.
    pieces = {"name": "Siomai", "qty": 2, "unit": "pc", "kcal": 110}
    assert weighed(pieces, 140, unit_said=True) == pieces
    # Grams spelled out become the "g" the review screen's stepper steps by.
    spelled = {"name": "Rice", "qty": 1, "unit": "grams", "kcal": 195}
    assert weighed(spelled, 150) == spelled | {"qty": 150, "unit": "g"}


def test_an_added_item_with_grams_and_no_unit_is_in_grams(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    api = fern(client, db)
    meal_id = _dinner(api, {**SERVING_CHICKEN, "qty": 132, "unit": "g"} | FOR_132)
    step, _ = turn(
        api,
        client,
        monkeypatch,
        # An explicit add: a bare "70g chicken andoks" after dinner is new
        # food, logged as its own entry (edit_meal refuses to put it inside).
        "add 70g chicken andoks to the dinner",
        act("edit_meal", meal_id=meal_id, add_items=[SEVENTY]),
    )
    assert step["ok"], step
    added = next(i for i in _chicken(api) if i.kcal == 156)
    # Was qty 1, unit "serving": the review screen read "1 serving".
    assert (added.qty, added.unit) == (70, "g")
    assert (added.kcal, added.protein, added.fat) == (156, 16.4, 9.9)


def test_a_weight_sent_as_qty_on_a_serving_item_is_sent_back(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    api = fern(client, db)
    meal_id = _dinner(api, SERVING_CHICKEN)
    # The exact edit Fern made on 2026-11-14 (edit_items, qty 132).
    step, model = turn(
        api,
        client,
        monkeypatch,
        "the dinner chicken was 132 g",
        act(
            "edit_meal",
            meal_id=meal_id,
            edit_items=[{"item": CHICKEN, "qty": 132, **FOR_132, "sat_fat": 5.3}],
        ),
    )
    out = tool_result(model)
    assert out["error"] == "fix_these_items_then_call_again", out
    assert out["items"][0]["problems"][0]["problem"] == (
        "qty_counts_servings_send_a_weight_as_grams"
    )
    # Nothing was written: before the fix this saved "132 serving".
    (chicken,) = _chicken(api)
    assert (chicken.qty, chicken.unit, chicken.kcal) == (1, "serving", 156)


def test_a_new_weight_makes_a_serving_item_one_in_grams_then_undo(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    api = fern(client, db)
    meal_id = _dinner(api, SERVING_CHICKEN)
    step, _ = turn(
        api,
        client,
        monkeypatch,
        "the dinner chicken was 132 g",
        act(
            "edit_meal",
            meal_id=meal_id,
            edit_items=[{"item": CHICKEN, "grams": 132, **FOR_132, "sat_fat": 5.3}],
        ),
    )
    assert step["ok"] and step["state"] == "saved", step
    (chicken,) = _chicken(api)
    # Shown as "132 g" with the values for 132 g; the stepper then moves it
    # 25 g at a time and its macros scale by weight.
    assert (chicken.qty, chicken.unit) == (132, "g")
    assert (chicken.kcal, chicken.protein, chicken.fat, chicken.sat_fat) == (
        294,
        30.9,
        18.7,
        5.3,
    )
    # The stale ", about 70 g" is gone from the note.
    assert chicken.assumption == SEVENTY["assumption"]

    undo(api, step)
    (chicken,) = _chicken(api)
    assert (chicken.qty, chicken.unit, chicken.kcal) == (1, "serving", 156)


def test_a_new_weight_without_its_values_is_sent_back(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    api = fern(client, db)
    meal_id = _dinner(api, SERVING_CHICKEN)
    _, model = turn(
        api,
        client,
        monkeypatch,
        "the dinner chicken was 132 g",
        act("edit_meal", meal_id=meal_id, edit_items=[{"item": CHICKEN, "grams": 132}]),
    )
    out = tool_result(model)
    problem = out["items"][0]["problems"][0]
    assert problem == {
        "problem": "send_values_for_the_new_weight",
        "missing": ["kcal", "protein", "carbs", "fat"],
    }
    (chicken,) = _chicken(api)
    assert (chicken.qty, chicken.unit) == (1, "serving")


def test_a_new_weight_on_an_item_in_grams_scales_it(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    api = fern(client, db)
    meal_id = _dinner(api, SERVING_CHICKEN)
    step, _ = turn(
        api,
        client,
        monkeypatch,
        "only 75 g of rice",
        act("edit_meal", meal_id=meal_id, edit_items=[{"item": "rice", "grams": 75}]),
    )
    assert step["ok"], step
    rice = next(i for i in live(rows_of(api, MealItem)) if i.name.startswith("White"))
    assert (rice.qty, rice.unit, rice.kcal) == (75, "g", 98)
