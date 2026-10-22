"""Grams the person says in a photo caption are exact: the photo estimate is
scaled to them, and a correction ("I mean ...") wins."""

from app.modules.capture.photo import honour_grams, said_grams

DINNER = (
    "Dinner: 130 g of pit Canton then 95 g of roasted chicken I mean classic "
    "savage chicken 130 g of pit Canton then 95 g of classic savory chicken"
)


def test_every_weighed_food_is_found_in_order() -> None:
    assert [g for g, _ in said_grams(DINNER)] == [130, 95, 130, 95]
    assert said_grams("half rice and adobo") == []


def test_an_item_estimated_at_another_weight_is_scaled_to_the_one_said() -> None:
    # What the photo model returned for the dinner above on 2026-10-22.
    items = [
        {
            "name": "Pancit canton (stir-fried noodles)",
            "qty": 130.0,
            "unit": "g",
            "kcal": 235.0,
            "fat": 7.5,
        },
        {
            "name": "Classic Savory chicken (roast/braised chicken leg with skin)",
            "qty": 62.0,
            "unit": "g",
            "kcal": 131.0,
            "protein": 14.0,
            "fiber": None,
        },
    ]
    noodles, chicken = honour_grams(items, DINNER)
    assert noodles == items[0]
    assert chicken["qty"] == 95
    # 131 kcal and 14 g protein at 62 g, scaled by 95 / 62.
    assert (chicken["kcal"], chicken["protein"]) == (200.7, 21.5)
    assert chicken["fiber"] is None


def test_items_not_in_grams_or_not_named_are_left_alone() -> None:
    items = [
        {"name": "Rice", "qty": 1, "unit": "cup", "kcal": 200.0},
        {"name": "Adobo", "qty": 150, "unit": "g", "kcal": 300.0},
    ]
    assert honour_grams(items, "1 cup rice and 95 g of chicken") == items
