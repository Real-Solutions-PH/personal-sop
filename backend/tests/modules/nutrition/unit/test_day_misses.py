"""What one closed nutrition day missed, for the Yesterday list and the
Misses page. Mirrors ``mobile/src/prototype/__tests__/nutrition-module.test.tsx``
title for title, so the phone (prototype mode) and the server (live mode)
write the same misses."""

from datetime import UTC, date, datetime

from app.modules.fitness import calc as C
from app.modules.nutrition.stats import day_misses

DAY = date(2026, 11, 7)
TARGET = C.TargetS(
    id="t", effective_from=date(2020, 1, 1), kcal=2000, protein=140, carbs=220, fat=60
)


def state(target: C.TargetS = TARGET, **item: float | None) -> C.FitState:
    """One confirmed meal at noon on DAY with one item."""
    kcal = item.pop("kcal", 2000) or 0
    protein = item.pop("protein", 140) or 0
    return C.FitState(
        targets=[target],
        meals=[
            C.MealS(
                id="m",
                eaten_at=datetime(2026, 11, 7, 12, tzinfo=UTC),
                items=[
                    C.MealItemS(
                        id="i", name="Adobo", kcal=kcal, protein=protein,
                        carbs=200, fat=60, **item,  # type: ignore[arg-type]
                    )
                ],
            )
        ],
    )  # fmt: skip


def titles(s: C.FitState) -> list[tuple[str, str, str]]:
    d = C.nutrition_day(s, DAY)
    return [(m.id, m.title, m.kind) for m in day_misses(s, d)]


def test_over_calories_and_short_protein_in_reading_order() -> None:
    # 2,600 kcal is 30% over 2,000; 60 g of protein is 80 g short of 140 g.
    assert titles(state(kcal=2600, protein=60)) == [
        ("nut-over-2026-11-07", "Over calories by 30%", "calories"),
        ("nut-protein-2026-11-07", "Protein short by 80 g (60 of 140 g)", "protein"),
    ]


def test_fiber_short_and_a_limit_crossed_by_the_defaults() -> None:
    # Fiber 10 g of the 25 g default (under 90%); sodium 2,450 mg of the
    # 2,000 mg default (450 over); sugar exactly at the 50 g limit (not
    # over); sat fat unknown (not judged).
    assert titles(state(fiber=10, sodium=2450, sugar=50)) == [
        ("nut-fiber-2026-11-07", "Fiber short by 15 g (10 of 25 g)", "fiber"),
        (
            "nut-limit-sodium-2026-11-07",
            "Over sodium limit by 450 mg (2,450 of 2,000 mg)",
            "limit",
        ),
    ]


def test_sat_fat_limit_uses_the_targets_own() -> None:
    own = C.TargetS(**{**TARGET.__dict__, "sat_fat_max_g": 13})
    assert titles(state(own, sat_fat=17)) == [
        (
            "nut-limit-satFat-2026-11-07",
            "Over sat fat limit by 4 g (17 of 13 g)",
            "limit",
        )
    ]


def test_own_goals_met_and_nothing_known_misses_nothing() -> None:
    own = C.TargetS(**{**TARGET.__dict__, "fiber_g": 10, "sodium_max_mg": 3000})
    assert titles(state(own, fiber=10, sodium=2450)) == []
    # No detail on the item: fiber and limits are unknown, not zero.
    assert titles(state()) == []


def test_no_target_or_no_meal_is_not_judged() -> None:
    s = state(kcal=2600, protein=10)
    s.targets = []
    assert titles(s) == []
    s = state(kcal=2600, protein=10)
    s.meals = []
    assert titles(s) == []
