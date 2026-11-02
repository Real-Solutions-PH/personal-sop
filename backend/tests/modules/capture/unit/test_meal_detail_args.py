"""Fern's meal tools ask for every detail the daily limits and goals count.

Sugar and sodium carried a description telling the model to estimate them;
saturated fat and fiber carried none, and a day of meals was saved with no
saturated fat at all. Each detail field now says to estimate it."""

import pytest
from pydantic import BaseModel

from app.modules.capture import fitness_tools, ports
from app.modules.capture.agent import MealItemArgs

DETAILS = ("fiber", "sat_fat", "sugar", "sodium")


@pytest.mark.parametrize("model", [MealItemArgs, fitness_tools.ItemArgs])
@pytest.mark.parametrize("field", DETAILS)
def test_every_detail_asks_for_an_estimate(model: type[BaseModel], field: str) -> None:
    says = model.model_json_schema()["properties"][field].get("description", "")
    assert "estimate it" in says


def test_the_warning_names_saturated_fat_in_plain_words() -> None:
    item = {
        "name": "Fried chicken",
        "kcal": 300,
        "protein": 25,
        "carbs": 8,
        "fat": 18,
        "fiber": 0.5,
        "sugar": 0,
        "sodium": 600,
    }
    assert ports.meal_missing_details([item]) == (
        "No saturated fat estimate for Fried chicken"
    )
