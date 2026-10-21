"""Business-day clock. Expected instants are hand-computed: Asia/Manila is
UTC+8 with no DST; America/New_York sprang forward on 2026-03-08 02:00."""

from datetime import date, datetime, timezone

import pytest

from app.shared.day import DayClock, days_between, js_weekday, parse_hm, week_start

MNL = DayClock()  # Asia/Manila, 04:00


def utc(*args: int) -> datetime:
    return datetime(*args, tzinfo=timezone.utc)


def test_before_day_start_belongs_to_previous_day() -> None:
    # 2026-10-19 03:59 Manila == 2026-10-18 19:59Z
    assert MNL.day_of(utc(2026, 10, 18, 19, 59)) == date(2026, 10, 18)


def test_at_day_start_belongs_to_new_day() -> None:
    # 2026-10-19 04:00 Manila == 2026-10-18 20:00Z
    assert MNL.day_of(utc(2026, 10, 18, 20, 0)) == date(2026, 10, 19)


def test_start_of_and_window_are_aware_utc() -> None:
    assert MNL.start_of(date(2026, 10, 19)) == utc(2026, 10, 18, 20, 0)
    first, end = MNL.window(date(2026, 10, 19), date(2026, 10, 20))
    assert (first, end) == (utc(2026, 10, 18, 20), utc(2026, 10, 20, 20))


def test_window_rejects_reversed_range() -> None:
    with pytest.raises(ValueError):
        MNL.window(date(2026, 10, 2), date(2026, 10, 1))


def test_naive_datetime_is_refused() -> None:
    with pytest.raises(ValueError):
        MNL.day_of(datetime(2026, 10, 18, 12, 0))


def test_local_time_after_midnight_is_the_same_night() -> None:
    # A 01:00 time on business day 10-18 is calendar 10-19 01:00 Manila.
    assert MNL.local_time(date(2026, 10, 18), "01:00") == utc(2026, 10, 18, 17, 0)
    assert MNL.local_time(date(2026, 10, 18), "23:30") == utc(2026, 10, 18, 15, 30)


def test_dst_day_is_23_hours_long() -> None:
    ny = DayClock(timezone="America/New_York", start_hour=4)
    first, end = ny.window(date(2026, 3, 8), date(2026, 3, 8))
    assert first == utc(2026, 3, 8, 8, 0)  # 04:00 EDT
    assert (end - first).total_seconds() == 24 * 3600
    prev_first, _ = ny.window(date(2026, 3, 7), date(2026, 3, 7))
    assert prev_first == utc(2026, 3, 7, 9, 0)  # 04:00 EST
    assert (first - prev_first).total_seconds() == 23 * 3600


def test_invalid_clock_settings_are_rejected() -> None:
    with pytest.raises(ValueError):
        DayClock(start_hour=24)
    with pytest.raises(ValueError):
        DayClock(timezone="Mars/Olympus")


@pytest.mark.parametrize("bad", ["7:00", "24:00", "12:60", "ab:cd", "12-00", ""])
def test_parse_hm_is_strict(bad: str) -> None:
    with pytest.raises(ValueError):
        parse_hm(bad)


def test_week_start_and_js_weekday() -> None:
    sunday = date(2026, 10, 18)
    assert js_weekday(sunday) == 0
    assert js_weekday(date(2026, 10, 19)) == 1
    assert week_start(sunday, 1) == date(2026, 10, 12)
    assert week_start(sunday, 0) == sunday
    assert week_start(date(2026, 10, 24), 0) == sunday  # Saturday


def test_days_between_is_inclusive() -> None:
    assert days_between(date(2026, 10, 1), date(2026, 10, 3)) == [
        date(2026, 10, 1),
        date(2026, 10, 2),
        date(2026, 10, 3),
    ]
