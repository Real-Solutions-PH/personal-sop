"""A scripted ``log_meal`` item with every value the day counts, for tests
about something else: an item left without one is sent back once
(``send_items_with_every_nutrient``)."""

from typing import Any

# Zero passes every value check (fiber within carbs, saturated within fat).
NO_DETAILS = {
    "protein": 0,
    "carbs": 0,
    "fat": 0,
    "fiber": 0,
    "fiber_soluble": 0,
    "fiber_insoluble": 0,
    "sat_fat": 0,
    "sugar": 0,
    "sodium": 0,
}


def full(item: dict[str, Any]) -> dict[str, Any]:
    """``item`` with zero for every value it doesn't give."""
    return {**NO_DETAILS, **item}
