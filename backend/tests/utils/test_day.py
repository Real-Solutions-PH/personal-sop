"""``settled_today`` at the instants around the business-day rollover
(Asia/Manila, 04:00 day start = 20:00 UTC)."""

from datetime import date, datetime, timezone

import pytest

from tests.utils import day as D


def utc(y: int, mo: int, d: int, h: int, mi: int, s: int = 0) -> datetime:
    return datetime(y, mo, d, h, mi, s, tzinfo=timezone.utc)


@pytest.mark.parametrize(
    ("now", "expected", "waits"),
    [
        # 03:59 Manila: the day rolls over in a minute; wait, then the new day.
        (utc(2026, 11, 11, 19, 59), date(2026, 11, 12), True),
        # 03:58:29 Manila: 91 s left, more than SETTLE; no wait.
        (utc(2026, 11, 11, 19, 58, 29), date(2026, 11, 11), False),
        # 04:01 Manila: the new day has begun.
        (utc(2026, 11, 11, 20, 1), date(2026, 11, 12), False),
        # 23:59 UTC = 07:59 Manila, the 12th.
        (utc(2026, 11, 11, 23, 59), date(2026, 11, 12), False),
        # 12:00 UTC = 20:00 Manila, still the 11th.
        (utc(2026, 11, 11, 12, 0), date(2026, 11, 11), False),
    ],
)
def test_settled_today_around_the_rollover(
    monkeypatch: pytest.MonkeyPatch, now: datetime, expected: date, waits: bool
) -> None:
    slept: list[float] = []
    monkeypatch.setattr("tests.utils.day.time.sleep", slept.append)
    # After the wait the clock reads the new day (what sleeping would show).
    monkeypatch.setattr(
        "app.shared.day.DayClock.today", lambda self: date(2026, 11, 12)
    )
    assert D.settled_today(now=now) == expected
    assert bool(slept) is waits
    if waits:
        assert 60 < slept[0] <= 62
