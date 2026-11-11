"""Applying per-day time overrides to calendar items. Pure: no database."""

import uuid
from collections.abc import Generator
from datetime import date

import pytest

from app.modules.schedule import logic as L
from app.modules.stats.contract import CalendarItem


# The suite-wide autouse fixtures provision a database; these checks need none.
@pytest.fixture(scope="session", autouse=True)
def db() -> Generator[None, None, None]:
    yield None


@pytest.fixture(scope="session", autouse=True)
def app_user_engine() -> Generator[None, None, None]:
    yield None


D = date(2026, 11, 12)
H = uuid.UUID("11111111-1111-4111-8111-111111111111")
R = uuid.UUID("22222222-2222-4222-8222-222222222222")
T = uuid.UUID("33333333-3333-4333-8333-333333333333")


def _item(item_id: str, day: date = D, time: str | None = "09:00") -> CalendarItem:
    return CalendarItem(
        id=item_id, day=day, title="x", module="habits", href="/", time=time
    )


def test_a_habit_moved_for_one_day_takes_the_new_time_that_day_only() -> None:
    other = date(2026, 11, 13)
    items = [_item(f"habit-{H}-{D}"), _item(f"habit-{H}-{other}", day=other)]
    out = L.apply_overrides(items, [L.Override("habit", H, D, "14:30")])
    assert [i.time for i in out] == ["14:30", "09:00"]


def test_routine_and_task_items_are_matched_by_their_own_ids() -> None:
    items = [_item(f"routine-{R}-{D}"), _item(f"task:{T}")]
    out = L.apply_overrides(
        items,
        [L.Override("routine", R, D, "06:15"), L.Override("task", T, D, "18:00")],
    )
    assert [i.time for i in out] == ["06:15", "18:00"]


def test_a_task_override_for_another_day_is_ignored() -> None:
    # A recurring task's occurrence moved, then the task re-dated: the old
    # day's override no longer describes it.
    items = [_item(f"task:{T}", day=date(2026, 11, 14))]
    out = L.apply_overrides(items, [L.Override("task", T, D, "18:00")])
    assert out[0].time == "09:00"


def test_an_untimed_item_gets_the_moved_time() -> None:
    out = L.apply_overrides(
        [_item(f"habit-{H}-{D}", time=None)], [L.Override("habit", H, D, "07:45")]
    )
    assert out[0].time == "07:45"


def test_a_kind_mismatch_moves_nothing() -> None:
    out = L.apply_overrides(
        [_item(f"habit-{H}-{D}")], [L.Override("routine", H, D, "07:45")]
    )
    assert out[0].time == "09:00"


@pytest.mark.parametrize("bad", ["24:00", "9:00", "09:60", "ab:cd", "", "09:00:00"])
def test_clock_rejects_anything_but_hh_mm(bad: str) -> None:
    assert not L.is_clock(bad)


@pytest.mark.parametrize("good", ["00:00", "03:59", "23:45", "09:07"])
def test_clock_accepts_hh_mm(good: str) -> None:
    assert L.is_clock(good)
