"""Fern reads any of the person's records (``query_records``), and its meal
estimates are checked before they are saved.

Seen live 2026-10-26 to 10-28: asked about its own past data, Fern had only
fixed canned answers; a chicken inasal quarter was logged at 17 g protein
with no portion on record; an "unsweetened" drink kept 22 g sugar against
12 g carbs because an edit could not change sugar."""

from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session

from app.modules.capture.models import RecordCard
from app.modules.fitness.models import MealItem
from tests.modules.companion.api.test_fern_agent import act, live, rows_of
from tests.modules.companion.api.test_fern_fitness import _meal, fern, tool_result, turn

INASAL = {
    "name": "Chicken inasal pecho",
    "qty": 1,
    "unit": "piece",
    "kcal": 330,
    "protein": 40,
    "carbs": 4,
    "fat": 17,
    "sugar": 2,
    "sodium": 600,
    "grams": 150,
    "assumption": "breast quarter with skin",
}


def test_query_records_sums_the_meals_of_a_range(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    api = fern(client, db)
    _meal(api)  # 2 eggs (140 kcal, 12 g protein) and 1 cup rice (205, 4)
    _, model = turn(
        api,
        client,
        monkeypatch,
        "what did most of my calories come from this week?",
        act("query_records", area="meals", days=7, group_by="food"),
    )
    out = tool_result(model)
    assert out["area"] == "meals"
    assert out["days_in_range"] == 7 and out["days_with_records"] == 1
    assert [(g["key"], g["sum"]["kcal"]) for g in out["groups"]] == [
        ("Rice", 205),
        ("Egg", 140),
    ]
    assert out["total"]["kcal"] == 345 and out["total"]["protein"] == 16


def test_query_records_refuses_a_grouping_the_area_lacks(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    api = fern(client, db)
    _, model = turn(
        api,
        client,
        monkeypatch,
        "my weight by category",
        act("query_records", area="weight", group_by="category"),
    )
    out = tool_result(model)
    assert out["error"] == "cannot_group_by_that"
    assert "category" not in out["group_by_one_of"]


def test_query_records_money_reads_as_money(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    api = fern(client, db)
    _, model = turn(
        api,
        client,
        monkeypatch,
        "how much did I spend this month?",
        act("query_records", area="money", days=30, group_by="category"),
    )
    out = tool_result(model)
    # Minor units never reach the model: the keys lose "_minor" and the
    # values are money text.
    assert "spent_minor" not in out["total"]
    assert out["total"]["spent"].endswith("0.00")


def test_log_meal_sends_an_unchecked_estimate_back(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    api = fern(client, db)
    bad = {k: v for k, v in INASAL.items() if k not in ("grams", "sugar")}
    _, model = turn(
        api,
        client,
        monkeypatch,
        "lunch was a chicken inasal pecho",
        act("log_meal", description="Lunch: chicken inasal pecho", items=[bad]),
    )
    out = tool_result(model)
    assert out["error"] == "fix_these_items_then_call_again"
    [item] = out["items"]
    assert item["item"] == "Chicken inasal pecho"
    assert {p["problem"] for p in item["problems"]} == {
        "grams_missing",
        "estimate_sugar_and_sodium",
    }
    assert not [c for c in rows_of(api, RecordCard) if c.kind == "meal"]


def test_log_meal_keeps_the_assumed_portion(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    api = fern(client, db)
    _, model = turn(
        api,
        client,
        monkeypatch,
        "lunch was a chicken inasal pecho",
        act(
            "log_meal",
            description="Lunch: chicken inasal pecho",
            items=[INASAL],
            confidence=0.9,
        ),
    )
    assert "error" not in tool_result(model)
    [it] = [i for i in live(rows_of(api, MealItem)) if i.name == "Chicken inasal pecho"]
    assert it.assumption == "breast quarter with skin, about 150 g"
    assert (it.protein, it.sugar, it.sodium) == (40, 2, 600)


def _drink_meal(api: Any) -> str:
    return str(
        api.post(
            "/fitness/meals",
            {
                "label": "breakfast",
                "raw_input": "hot chocolate",
                "items": [
                    {
                        "name": "Hot chocolate",
                        "qty": 1,
                        "unit": "mug",
                        "kcal": 260,
                        "protein": 7,
                        "carbs": 34,
                        "fat": 11,
                        "sugar": 22,
                    }
                ],
            },
        )["id"]
    )


def test_edit_meal_can_change_sugar(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    api = fern(client, db)
    meal_id = _drink_meal(api)
    step, _ = turn(
        api,
        client,
        monkeypatch,
        "the chocolate was unsweetened",
        act(
            "edit_meal",
            meal_id=meal_id,
            edit_items=[
                {"item": "hot chocolate", "kcal": 175, "carbs": 12, "sugar": 4}
            ],
        ),
    )
    assert step["ok"], step
    [it] = live(rows_of(api, MealItem))
    assert (it.kcal, it.carbs, it.sugar) == (175, 12, 4)


def test_edit_meal_refuses_sugar_above_carbs(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    api = fern(client, db)
    meal_id = _drink_meal(api)
    # The live failure: carbs lowered, sugar left at 22.
    _, model = turn(
        api,
        client,
        monkeypatch,
        "the chocolate was unsweetened",
        act(
            "edit_meal",
            meal_id=meal_id,
            edit_items=[{"item": "hot chocolate", "kcal": 175, "carbs": 12}],
        ),
    )
    out = tool_result(model)
    assert out["error"] == "fix_these_items_then_call_again"
    assert out["items"][0]["problems"][0]["problem"] == "sugar_more_than_carbs"
    [it] = live(rows_of(api, MealItem))
    assert (it.kcal, it.carbs) == (260, 34)
