"""Per-day schedule overrides: an item moved to another time on one day.

Moving a habit or a routine on the Plan tab changes its time for that date
only; its own schedule ("Every day · 9am") is untouched. A one-off task is
moved by changing its due time instead (it has no series to protect), but an
occurrence of a recurring task is moved here, so the next occurrence keeps
the series' time. Pure: no database.
"""

import re
import uuid
from collections.abc import Iterable
from dataclasses import dataclass, replace
from datetime import date
from typing import Literal

from app.modules.stats.contract import CalendarItem

Kind = Literal["habit", "routine", "task"]
KINDS: tuple[Kind, ...] = ("habit", "routine", "task")

_CLOCK = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")


DAY_START_HOUR = 4


def day_minutes(clock: str) -> int:
    """``HH:MM`` as minutes on the business day: the small hours (before
    04:00) come after midnight, so 01:30 is 25 h 30 m."""
    h, m = int(clock[:2]), int(clock[3:5])
    return (h + 24 if h < DAY_START_HOUR else h) * 60 + m


def shift_minutes(own: str, moved: str) -> int:
    """How far a move took an item, in minutes on its business day."""
    return day_minutes(moved) - day_minutes(own)


def is_clock(value: str) -> bool:
    """``HH:MM`` on a 24-hour clock, as every schedule slot stores it."""
    return bool(_CLOCK.match(value))


@dataclass(frozen=True)
class Override:
    kind: Kind
    ref_id: uuid.UUID
    day: date
    time: str


def item_id(o: Override) -> str:
    """The calendar item an override moves (ids as ``stats.calendar`` and the
    phone's ``useCalendar`` mint them)."""
    if o.kind == "task":
        return f"task:{o.ref_id}"
    return f"{o.kind}-{o.ref_id}-{o.day.isoformat()}"


def apply_overrides(
    items: Iterable[CalendarItem], overrides: Iterable[Override]
) -> list[CalendarItem]:
    """Items with each moved one at its time for that day."""
    moved = {(item_id(o), o.day): o.time for o in overrides}
    out: list[CalendarItem] = []
    for i in items:
        t = moved.get((i.id, i.day))
        out.append(i if t is None else replace(i, time=t))
    return out
