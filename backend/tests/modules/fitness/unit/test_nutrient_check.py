"""Nutrition values a meal item can't have, caught before it is saved.

Expected values are worked by hand from the Atwater factors (4 kcal per g
of protein and carbs, 9 per g of fat, 7 per g of alcohol)."""

from app.modules.fitness.nutrient_check import (
    PLAIN,
    estimate_problems,
    involves,
    missing_details,
    plain,
    value_problems,
)

# 1 cup cooked white rice, USDA: 205 kcal, 4.3 g protein, 44.5 g carbs,
# 0.4 g fat -> 4*4.3 + 4*44.5 + 9*0.4 = 198.8 kcal.
RICE = {
    "name": "White rice",
    "kcal": 205,
    "protein": 4.3,
    "carbs": 44.5,
    "fat": 0.4,
    "fiber": 0.6,
    "sat_fat": 0.1,
    "sugar": 0.1,
    "sodium": 2,
    "grams": 158,
}


def codes(problems: list[dict[str, object]]) -> list[object]:
    return [p["problem"] for p in problems]


def test_consistent_item_passes() -> None:
    assert value_problems(RICE) == []
    assert estimate_problems(RICE) == []


def test_sugar_above_carbs() -> None:
    # Seen live: an "unsweetened" drink kept 22 g sugar against 12 g carbs.
    drink = RICE | {"kcal": 175, "protein": 7, "carbs": 12, "fat": 11, "sugar": 22}
    assert codes(value_problems(drink)) == ["sugar_more_than_carbs"]


def test_fiber_above_carbs() -> None:
    assert codes(value_problems(RICE | {"fiber": 50})) == ["fiber_more_than_carbs"]


def test_sat_fat_above_fat() -> None:
    assert codes(value_problems(RICE | {"sat_fat": 3})) == ["sat_fat_more_than_fat"]


def test_rounding_slack_is_allowed() -> None:
    # Labels round each line; 0.4 g over is rounding, not an error.
    assert value_problems(RICE | {"sugar": 44.9}) == []


def test_kcal_far_from_macros() -> None:
    # 4*20 + 4*0 + 9*19 = 251 vs 400 given: off by 149 (> 25 % and > 30).
    chicken = {
        "name": "fried chicken",
        "kcal": 400,
        "protein": 20,
        "carbs": 0,
        "fat": 19,
    }
    [p] = value_problems(chicken)
    assert p["problem"] == "kcal_does_not_match_macros"
    assert p["kcal_from_macros"] == 251


def test_kcal_close_to_macros_passes() -> None:
    # 251 from macros vs 270 given: off by 19, inside the 30 kcal floor.
    chicken = {
        "name": "fried chicken",
        "kcal": 270,
        "protein": 20,
        "carbs": 0,
        "fat": 19,
    }
    assert value_problems(chicken) == []


def test_alcohol_counts_toward_kcal() -> None:
    # A beer: 4*1.6 + 4*13 + 9*0 = 58.4, plus 7*14 = 98 from alcohol -> 156.4.
    beer = {"name": "beer", "kcal": 153, "protein": 1.6, "carbs": 13, "fat": 0}
    assert codes(value_problems(beer)) == ["kcal_does_not_match_macros"]
    assert value_problems(beer | {"alcohol": 14}) == []


def test_missing_macros_are_not_checked() -> None:
    # An edit that names only kcal can't be checked against macros it lacks.
    assert value_problems({"name": "x", "kcal": 300}) == []


def test_estimate_needs_grams() -> None:
    no_grams = {k: v for k, v in RICE.items() if k != "grams"}
    assert codes(estimate_problems(no_grams)) == ["grams_missing"]


def test_energy_density_ceiling() -> None:
    # Pure fat is 900 kcal per 100 g; 200 kcal in 10 g is 2,000 per 100 g.
    oil = {
        "name": "oil",
        "kcal": 200,
        "protein": 0,
        "carbs": 0,
        "fat": 22,
        "sugar": 0,
        "sodium": 0,
        "grams": 10,
    }
    assert "more_than_900_kcal_per_100g" in codes(estimate_problems(oil))


def test_macros_heavier_than_the_food() -> None:
    # 120 g protein + 2 g fat can't fit in 100 g of chicken.
    chicken = {
        "name": "chicken",
        "kcal": 500,
        "protein": 120,
        "carbs": 0,
        "fat": 2,
        "sugar": 0,
        "sodium": 400,
        "grams": 100,
    }
    assert codes(estimate_problems(chicken)) == ["macros_heavier_than_the_food"]


def test_each_problem_names_the_values_it_is_about() -> None:
    [p] = value_problems(RICE | {"sugar": 60})
    assert involves(p) == {"sugar", "carbs"}
    [p] = value_problems(
        {"name": "x", "kcal": 400, "protein": 20, "carbs": 0, "fat": 19}
    )
    assert involves(p) == {"kcal", "protein", "carbs", "fat"}


def test_missing_sugar_and_sodium_do_not_refuse_an_estimate() -> None:
    # They count toward the daily limits, so they are flagged, but a meal
    # without them is still worth saving: refusing it lost the whole lunch.
    bare = {k: v for k, v in RICE.items() if k not in ("sugar", "sodium")}
    assert estimate_problems(bare) == []
    assert missing_details(bare) == ["sugar", "sodium"]
    assert missing_details(RICE) == []


def test_every_problem_reads_in_plain_words() -> None:
    items = [
        {k: v for k, v in RICE.items() if k != "grams"},
        RICE | {"sugar": 60, "fiber": 60, "sat_fat": 5, "kcal": 900},
        RICE | {"grams": 10, "kcal": 205},
    ]
    found = {p["problem"]: p for it in items for p in estimate_problems(it)}
    assert set(found) == set(PLAIN)
    for p in found.values():
        words = plain(p)
        assert words and "_" not in words, words
