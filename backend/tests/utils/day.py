"""The business day a test runs on, read when the test starts.

A test that fixes "today" at import gets the day pytest COLLECTED on: a CI
run that started at 19:54 UTC (03:54 in Manila, before the 04:00 day start)
ran its finance tests at 20:15 UTC, when the server's day was one later, and
six tests failed with dates one day apart (2026-11-11). So a test reads the
day when it starts, and a start within ``SETTLE`` of the day rolling over
waits for the new day first, so the day cannot change under a test.
"""

import time
from datetime import date, datetime, timedelta, timezone

from app.shared.day import DayClock

# Longer than any one test takes.
SETTLE = timedelta(seconds=90)


def settled_today(clock: DayClock | None = None, now: datetime | None = None) -> date:
    """``clock``'s business day (a new user's default clock if None), after
    waiting out a rollover closer than ``SETTLE``."""
    clock = clock or DayClock()
    at = now or datetime.now(timezone.utc)
    day = clock.day_of(at)
    left = clock.start_of(day + timedelta(days=1)) - at
    if left < SETTLE:
        time.sleep(left.total_seconds() + 1)
        return clock.today()
    return day


class RunDay(date):
    """A module's ``TODAY`` that means "the day the test runs on": the
    ``business_today`` fixture (tests/conftest.py) re-reads it as each test
    starts. A ``TODAY`` pinned to a fixed date (a golden fixture's) is a plain
    ``date`` and is left alone."""


def run_day(clock: DayClock | None = None) -> RunDay:
    """The business day now, marked to be re-read per test (``RunDay``)."""
    d = settled_today(clock)
    return RunDay(d.year, d.month, d.day)
