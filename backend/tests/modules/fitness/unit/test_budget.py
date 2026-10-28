"""Eat-back: the burned kcal added to one day's budget. Mirrors
``mobile/src/prototype/__tests__/burn-adjustment.test.ts`` number for number,
so the device and the server agree on the day's budget."""

from datetime import date, timedelta

import pytest

from app.modules.fitness import calc as C

DAY = date(2026, 10, 28)


def state(kcal: float = 2000, carbs: float = 200, fat: float = 600 / 9) -> C.FitState:
    return C.FitState(
        targets=[
            C.TargetS(
                id="t", effective_from=DAY, kcal=kcal, protein=150, carbs=carbs, fat=fat
            )
        ]
    )


def test_burn_goes_to_carbs_and_fat_by_calorie_ratio_protein_fixed() -> None:
    s = state()
    s.adjustments = [C.AdjustmentS(id="a", day=DAY, kcal=350)]
    b = C.budget_for(s, DAY)
    assert b is not None
    assert (b.kcal, b.protein) == (2350, 150)
    assert b.carbs == pytest.approx(200 + 350 * 800 / 1400 / 4)
    assert b.fat == pytest.approx(600 / 9 + 350 * 600 / 1400 / 9)


def test_adjustment_does_not_carry_to_the_next_day() -> None:
    s = state()
    s.adjustments = [C.AdjustmentS(id="a", day=DAY, kcal=350)]
    b = C.budget_for(s, DAY + timedelta(days=1))
    assert b is not None and b.kcal == 2000


def test_no_base_target_means_no_budget() -> None:
    s = C.FitState(adjustments=[C.AdjustmentS(id="a", day=DAY, kcal=300)])
    assert C.budget_for(s, DAY) is None


def test_target_for_ignores_adjustments() -> None:
    s = state()
    s.adjustments = [C.AdjustmentS(id="a", day=DAY, kcal=350)]
    t = C.target_for(s, DAY)
    assert t is not None and t.kcal == 2000


def test_base_with_no_carbs_or_fat_puts_burn_into_carbs() -> None:
    s = state(kcal=600, carbs=0, fat=0)
    s.adjustments = [C.AdjustmentS(id="a", day=DAY, kcal=400)]
    b = C.budget_for(s, DAY)
    assert b is not None and (b.carbs, b.fat) == (100, 0)


def test_day_verdict_and_macros_left_use_the_budget() -> None:
    s = state()
    s.adjustments = [C.AdjustmentS(id="a", day=DAY, kcal=400)]
    day = C.nutrition_day(s, DAY)
    assert day.target is not None and day.target.kcal == 2400
    left = C.macros_left(s, DAY)
    assert left is not None and left.kcal == 2400 and left.protein == 150
