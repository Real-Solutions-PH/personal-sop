"""Screen time's scoring rules (spec 2026-10-29-screen-time-design, "Rules"),
over hand-computed values: a day within budget scores 1, falling to 0 at
twice the budget; the area rate averages groups per closed day, then days."""

import uuid
from datetime import date

from app.modules.screen import logic as L

A, B, Z = uuid.UUID(int=1), uuid.UUID(int=2), uuid.UUID(int=3)
BUDGETS = {A: 60, B: 30, Z: 0}
D1, D2, D3 = date(2026, 10, 20), date(2026, 10, 21), date(2026, 10, 22)


def test_standard_rungs() -> None:
    assert L.STANDARD_RUNGS == (
        1, 5, 10, 15, 30, 45, 60, 75, 90, 105, 120, 135, 150, 165, 180, 195,
        210, 225, 240, 300, 360, 480,
    )  # fmt: skip


def test_day_score() -> None:
    assert L.day_score(30, 60) == 1
    assert L.day_score(60, 60) == 1
    assert L.day_score(90, 60) == 0.5
    assert L.day_score(120, 60) == 0
    assert L.day_score(500, 60) == 0


def test_day_score_zero_budget() -> None:
    assert L.day_score(0, 0) == 1
    assert L.day_score(15, 0) == 0


def test_area_rate_averages_groups_then_days() -> None:
    rows = [
        (D1, A, 90, True),  # 0.5
        (D1, B, 30, True),  # 1   -> day 0.75
        (D1, Z, 500, True),  # budget 0: not scored
        (D2, A, 30, True),  # 1   -> day 1
        (D3, A, 500, False),  # open: not counted
    ]
    assert L.area_rate(rows, BUDGETS) == 0.875


def test_area_rate_none_without_closed_scored_days() -> None:
    assert L.area_rate([], BUDGETS) is None
    assert L.area_rate([(D1, A, 10, False)], BUDGETS) is None
    assert L.area_rate([(D1, Z, 0, True)], BUDGETS) is None
    assert L.area_rate([(D1, uuid.UUID(int=9), 0, True)], BUDGETS) is None
