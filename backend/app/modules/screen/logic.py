"""Screen time's scoring rules (spec 2026-10-29-screen-time-design, "Rules"),
as pure functions. ``shared/prototype/screen/logic.ts`` is the same code on
the device; ``tests/golden/screen-logic.json`` pins the two together.

Every minute figure is a lower bound: the highest DeviceActivity threshold
("rung") the phone saw crossed that day.

- A group's day scores ``1`` within its budget, falling linearly to ``0`` at
  twice the budget. A zero budget scores 1 for no use and 0 for any, but such
  groups are never scored by :func:`area_rate`.
- The Screen time area's rate over a range: for each day with a closed row,
  the mean day score over its groups with a budget; then the mean over those
  days. ``None`` when there is no such day (the Life Score skips the area).
"""

import uuid
from collections.abc import Mapping, Sequence
from datetime import date

STANDARD_RUNGS: tuple[int, ...] = (
    1, 5, 10, 15, 30, 45, 60, 75, 90, 105, 120, 135, 150, 165, 180, 195,
    210, 225, 240, 300, 360, 480,
)  # fmt: skip


def day_score(used_min: int, budget_min: int) -> float:
    """One group's day: 1 within budget, 0 at twice the budget or beyond."""
    if used_min <= budget_min:
        return 1.0
    if budget_min <= 0:
        return 0.0
    return max(0.0, 1 - (used_min - budget_min) / budget_min)


def area_rate(
    days: Sequence[tuple[date, uuid.UUID, int, bool]],
    budgets: Mapping[uuid.UUID, int],
) -> float | None:
    """Mean over closed days of the mean day score of groups with a budget.

    ``days`` rows are ``(day, group_id, used_min, closed)``; rows that are
    open, or whose group is unknown or has no budget, are skipped.
    """
    per_day: dict[date, list[float]] = {}
    for day, group_id, used_min, closed in days:
        budget = budgets.get(group_id)
        if not closed or budget is None or budget <= 0:
            continue
        per_day.setdefault(day, []).append(day_score(used_min, budget))
    if not per_day:
        return None
    total = 0.0
    for day in sorted(per_day):
        scores = per_day[day]
        total += sum(scores) / len(scores)
    return total / len(per_day)
