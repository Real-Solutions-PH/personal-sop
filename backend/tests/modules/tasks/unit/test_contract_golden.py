"""The stats-contract outputs (``index.ts``) against the prototype."""

from datetime import date
from typing import Any

import pytest

from app.modules.tasks import logic as L
from app.shared.day import DayClock
from tests.modules.tasks.golden import load, seed_state

CLOCK = DayClock()
DATA = load("tasks-stats")["data"]
TODAY = date.fromisoformat(DATA["today"])
CONTRACT = DATA["contract"]


def _stats(days: int, offset: int) -> L.TaskStats:
    first, last = L.stats_window(TODAY, days, offset)
    return L.compute_stats(seed_state(), first, last, TODAY, CLOCK)


@pytest.mark.parametrize("days", ["7", "30", "90"])
def test_metrics(days: str) -> None:
    n = int(days)
    got = L.metrics(_stats(n, 0), _stats(n, n))
    want: list[dict[str, Any]] = CONTRACT["metrics"][days]
    assert [
        {
            "key": m.key,
            "label": m.label,
            "value": m.value,
            **({} if m.delta is None else {"delta": m.delta}),
            "goodWhen": m.good_when,
            "shareable": m.shareable,
        }
        for m in got
    ] == want


@pytest.mark.parametrize("key", ["7:0", "7:7", "30:0", "1:0"])
def test_area_rate(key: str) -> None:
    days, offset = (int(x) for x in key.split(":"))
    assert L.area_rate(_stats(days, offset)) == pytest.approx(CONTRACT["areaRate"][key])


def test_area_rate_without_due_tasks_is_half() -> None:
    empty = L.TasksState(lists=[], tasks=[])
    s = L.compute_stats(empty, TODAY, TODAY, TODAY, CLOCK)
    assert L.area_rate(s) == 0.5


def test_calendar() -> None:
    got = L.calendar(seed_state(), L.add_days(TODAY, -7), L.add_days(TODAY, 7))
    want = CONTRACT["calendar"]
    assert [
        {
            "id": c.id,
            "day": c.day.isoformat(),
            **({} if c.time is None else {"time": c.time}),
            "title": c.title,
            "module": c.module,
            "done": c.done,
            "href": c.href,
        }
        for c in got
    ] == want


def test_misses() -> None:
    got = L.misses(seed_state(), L.add_days(TODAY, -30), TODAY, TODAY, CLOCK)
    assert [
        {
            "id": m.id,
            "day": m.day.isoformat(),
            "title": m.title,
            "module": m.module,
            "href": m.href,
        }
        for m in got
    ] == CONTRACT["misses"]
    assert {m.kind for m in got} == {"overdue", "late", "pushed"}
