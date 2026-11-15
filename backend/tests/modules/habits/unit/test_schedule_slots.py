"""Several reminder times a day: a weekday may sit in more than one slot.

The phone schedules a habit reminded at 08:00 and 20:00 every day as two
slots on the same days, and shows it once per time in its timelines. The
server has to take that schedule on create, update and sync.
"""

import pytest
from pydantic import ValidationError

from app.modules.habits.schema import HabitCreate, HabitSyncIn, HabitUpdate

EVERY_DAY = [0, 1, 2, 3, 4, 5, 6]
TWICE = [
    {"days": EVERY_DAY, "time": "08:00"},
    {"days": EVERY_DAY, "time": "20:00"},
]


def test_two_times_on_the_same_days_are_accepted() -> None:
    created = HabitCreate.model_validate({"name": "Skin care", "schedule": TWICE})
    assert created.schedule is not None
    assert [s.time for s in created.schedule] == ["08:00", "20:00"]
    assert HabitUpdate.model_validate({"schedule": TWICE}).schedule is not None
    assert HabitSyncIn.model_validate({"schedule": TWICE}).schedule is not None


def test_a_schedule_still_needs_a_weekday() -> None:
    with pytest.raises(ValidationError):
        HabitCreate.model_validate(
            {"name": "Skin care", "schedule": [{"days": [], "time": "08:00"}]}
        )
