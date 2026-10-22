"""Changing an item's quantity scales its nutrient detail with its macros;
detail the estimate never had stays unknown, not zero."""

from app.modules.fitness import foods as F


def test_quantity_scales_fiber_sat_fat_sugar_and_sodium() -> None:
    it = F.ItemDraft(
        "Longganisa",
        2,
        "pc",
        320,
        14,
        10,
        25,
        fiber=0.5,
        sat_fat=9,
        sugar=7,
        sodium=780,
    )
    out = F.scale_item(it, 4)
    assert (out.kcal, out.fiber, out.sat_fat, out.sugar, out.sodium) == (
        640,
        1,
        18,
        14,
        1560,
    )


def test_unknown_detail_stays_unknown() -> None:
    it = F.ItemDraft("Rice", 1, "cup", 205, 4, 45, 0)
    out = F.scale_item(it, 2)
    assert (out.fiber, out.sat_fat, out.sugar, out.sodium) == (None, None, None, None)
