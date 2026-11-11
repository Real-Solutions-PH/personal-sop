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
