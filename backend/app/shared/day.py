"""The business day.

A "day" in this product is not a UTC calendar date. Each user has a time zone
(default ``Asia/Manila``) and a ``day_start_hour`` (default 4): a habit ticked
at 01:30 local time counts for the previous day. Streaks, "today", spend-today,
macros-left and the on-target rate all resolve their day through this module,
and every fetch window is computed here as an aware UTC interval so the query
and the comparison agree (never derive a day from ``date.today()`` or from a
UTC timestamp's ``.date()``).
"""

from dataclasses import dataclass
from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

DEFAULT_TIMEZONE = "Asia/Manila"
DEFAULT_DAY_START_HOUR = 4


@dataclass(frozen=True)
class DayClock:
    """A user's day boundary: time zone plus the hour the day rolls over."""

    timezone: str = DEFAULT_TIMEZONE
    start_hour: int = DEFAULT_DAY_START_HOUR

    def __post_init__(self) -> None:
        if not 0 <= self.start_hour <= 23:
            raise ValueError("day_start_hour must be within 0..23")
        ZoneInfo(self.timezone)  # raises ZoneInfoNotFoundError when unknown

    @property
    def zone(self) -> ZoneInfo:
        return ZoneInfo(self.timezone)

    def day_of(self, at: datetime) -> date:
        """The business day an instant belongs to."""
        if at.tzinfo is None:
            raise ValueError("naive datetime: business days need an aware instant")
        local = at.astimezone(self.zone)
        return (local - timedelta(hours=self.start_hour)).date()

    def today(self, now: datetime | None = None) -> date:
        return self.day_of(now or datetime.now(timezone.utc))

    def start_of(self, day: date) -> datetime:
        """The aware UTC instant a business day starts."""
        local = datetime.combine(day, time(self.start_hour), tzinfo=self.zone)
        return local.astimezone(timezone.utc)

    def window(self, first: date, last: date) -> tuple[datetime, datetime]:
        """Half-open UTC interval ``[start(first), start(last + 1))``."""
        if last < first:
            raise ValueError("window ends before it starts")
        return self.start_of(first), self.start_of(last + timedelta(days=1))

    def local_time(self, day: date, hm: str) -> datetime:
        """An ``HH:MM`` wall-clock time on a business day, as aware UTC.

        Times before the start hour belong to the next calendar date (a
        23:30 bedtime and a 01:00 one are both "tonight").
        """
        hour, minute = parse_hm(hm)
        calendar = day + timedelta(days=1) if hour < self.start_hour else day
        local = datetime.combine(calendar, time(hour, minute), tzinfo=self.zone)
        return local.astimezone(timezone.utc)


def parse_hm(hm: str) -> tuple[int, int]:
    """Parse a strict ``HH:MM`` 24-hour clock string."""
    if len(hm) != 5 or hm[2] != ":" or not (hm[:2] + hm[3:]).isdigit():
        raise ValueError(f"not an HH:MM time: {hm!r}")
    hour, minute = int(hm[:2]), int(hm[3:])
    if hour > 23 or minute > 59:
        raise ValueError(f"not an HH:MM time: {hm!r}")
    return hour, minute


def days_between(first: date, last: date) -> list[date]:
    """Every date from ``first`` to ``last`` inclusive."""
    return [first + timedelta(days=i) for i in range((last - first).days + 1)]


def week_start(day: date, week_starts_on: int) -> date:
    """The first day of ``day``'s week. ``week_starts_on``: 0 Sunday, 1 Monday."""
    # Python: Monday=0..Sunday=6 -> JS-style Sunday=0..Saturday=6
    js_dow = (day.weekday() + 1) % 7
    return day - timedelta(days=(js_dow - week_starts_on) % 7)


def js_weekday(day: date) -> int:
    """Weekday in the prototype's convention: 0 Sunday .. 6 Saturday."""
    return (day.weekday() + 1) % 7
