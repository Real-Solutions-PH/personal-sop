"""The retention rules (docs/26-retention-algorithms.md §3): pure functions,
no database."""

import uuid
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import pytest

from app.modules.retention import logic as L
from app.shared.grace import GRACE_GAP_DAYS, grace_ready, walk_run

MANILA = ZoneInfo("Asia/Manila")
NOW = datetime(2026, 11, 12, 12, 0, tzinfo=timezone.utc)  # Thu 20:00 Manila


def at_local(d: date, hh: int, mm: int = 0) -> datetime:
    return datetime(d.year, d.month, d.day, hh, mm, tzinfo=MANILA)


# ---------------------------------------------------------------- histogram


def test_slot_of_reads_the_half_hour() -> None:
    assert L.slot_of_minute(0) == 0
    assert L.slot_of_minute(29) == 0
    assert L.slot_of_minute(30) == 1
    assert L.slot_of_minute(19 * 60 + 45) == 39
    assert L.slot_of_hm("07:00") == 14


def test_half_life_decay_halves_weight_every_14_days() -> None:
    today = date(2026, 11, 12)  # a Thursday
    fresh = at_local(today, 9, 5)
    two_weeks = fresh - timedelta(days=14)  # also a Thursday
    four_weeks = fresh - timedelta(days=28)
    now = fresh.astimezone(timezone.utc)
    h = L.slot_histogram([fresh, two_weeks, four_weeks], now=now, zone=MANILA)
    s = L.slot_of_minute(9 * 60 + 5)
    assert h["weekday"][s] == pytest.approx(1 + 0.5 + 0.25)
    assert sum(h["weekend"]) == 0


def test_one_long_session_counts_once_per_day_and_slot() -> None:
    today = date(2026, 11, 12)
    burst = [at_local(today, 9, m) for m in (0, 3, 10, 29)]
    h = L.slot_histogram(burst, now=at_local(today, 10), zone=MANILA)
    assert sum(h["weekday"]) == pytest.approx(1.0, rel=1e-2)


def test_moments_older_than_60_days_or_in_the_future_are_ignored() -> None:
    today = date(2026, 11, 12)
    now = at_local(today, 12)
    h = L.slot_histogram(
        [now - timedelta(days=61), now + timedelta(hours=1)], now=now, zone=MANILA
    )
    assert sum(h["weekday"]) == 0 and sum(h["weekend"]) == 0


def test_weekend_moments_go_to_the_weekend_row_by_local_date() -> None:
    # Saturday 07:30 in Manila is Friday 23:30 UTC: the local date decides.
    sat = at_local(date(2026, 11, 14), 7, 30)
    h = L.slot_histogram([sat], now=sat + timedelta(hours=1), zone=MANILA)
    assert h["weekend"][15] > 0
    assert sum(h["weekday"]) == 0


def test_smoothing_is_a_circular_quarter_half_quarter() -> None:
    h = [0.0] * 48
    h[0] = 4.0
    sm = L.smooth(h)
    assert sm[0] == pytest.approx(2.0)
    assert sm[1] == pytest.approx(1.0)
    assert sm[47] == pytest.approx(1.0)  # wraps around midnight
    assert sum(sm) == pytest.approx(4.0)


# ---------------------------------------------------------------- eligibility


def test_only_slots_between_0700_and_2130_are_eligible() -> None:
    ok = L.eligible_slots(quiet_start="22:00", quiet_end="07:00", reminders=[])
    assert not ok[13]  # 06:30
    assert ok[14]  # 07:00
    assert ok[42]  # 21:00, sends 20:50
    assert not ok[43]  # 21:30


def test_quiet_hours_exclude_slots_even_inside_the_day_window() -> None:
    ok = L.eligible_slots(quiet_start="12:00", quiet_end="14:00", reminders=[])
    assert ok[23]  # 11:30, sends 11:20
    assert not ok[24]  # 12:00
    assert not ok[27]  # 13:30
    assert not ok[28]  # 14:00 sends at 13:50, still quiet
    assert ok[29]  # 14:30, sends 14:20


def test_slots_near_a_scheduled_reminder_are_excluded() -> None:
    ok = L.eligible_slots(quiet_start="22:00", quiet_end="07:00", reminders=[9 * 60])
    # Sends at slot start - 10 min: 08:20 is 40 min away, 08:50 10 min.
    assert not ok[17]  # 08:30 -> 08:20
    assert not ok[18]  # 09:00 -> 08:50
    assert not ok[19]  # 09:30 -> 09:20
    assert ok[16]  # 08:00 -> 07:50, 70 min away
    assert ok[20]  # 10:00 -> 09:50, 50 min away


def test_send_minute_arrives_ten_minutes_early_but_never_before_0700() -> None:
    assert L.send_minute(39) == 19 * 60 + 20
    assert L.send_minute(14) == 7 * 60


# ---------------------------------------------------------------- best slot


def test_cold_start_falls_back_to_push_evening_then_morning_then_1900() -> None:
    ok = L.eligible_slots(quiet_start="22:00", quiet_end="07:00", reminders=[])
    empty = [0.0] * 48
    thin = [0.0] * 48
    thin[20] = 4.9  # below the 5.0 floor: still cold
    assert L.best_slot(empty, ok, push_evening="20:00", push_morning="07:00") == 40
    assert L.best_slot(thin, ok, push_evening="20:00", push_morning="07:00") == 40
    assert L.best_slot(empty, ok, push_evening=None, push_morning="08:30") == 17
    assert L.best_slot(empty, ok, push_evening=None, push_morning=None) == 38


def test_cold_start_skips_a_fallback_that_is_not_eligible() -> None:
    # push_evening 21:30 is outside the window: push_morning is next.
    ok = L.eligible_slots(quiet_start="22:00", quiet_end="07:00", reminders=[])
    empty = [0.0] * 48
    assert L.best_slot(empty, ok, push_evening="21:30", push_morning="07:30") == 15


def test_warm_histogram_picks_the_smoothed_argmax_among_eligible_slots() -> None:
    ok = L.eligible_slots(quiet_start="12:00", quiet_end="14:00", reminders=[])
    h = [0.0] * 48
    h[25] = 10.0  # 12:30, quiet
    h[30] = 3.0  # 15:00
    h[31] = 3.0  # 15:30: (0.25*3 + 0.5*3) beats 15:00's equal score? tie -> earliest
    h[40] = 4.0  # 20:00 alone: smoothed 2.0
    best = L.best_slot(h, ok, push_evening="21:00", push_morning=None)
    assert best == 30


def test_warm_histogram_with_all_mass_in_ineligible_slots_falls_back() -> None:
    ok = L.eligible_slots(quiet_start="22:00", quiet_end="07:00", reminders=[])
    h = [0.0] * 48
    h[2] = 9.0  # 01:00, far from any eligible slot
    assert L.best_slot(h, ok, push_evening="20:00", push_morning=None) == 40


# ---------------------------------------------------------------- stage


T = date(2026, 11, 12)


def days(*offsets: int) -> set[date]:
    return {T - timedelta(days=o) for o in offsets}


def test_stage_new_wins_over_everything_in_the_first_two_weeks() -> None:
    assert L.stage_of(today=T, signup_day=T - timedelta(days=13), log_days=set()) == (
        "new"
    )


def test_stage_lapsed_from_15_days_and_lapsing_from_3() -> None:
    old = T - timedelta(days=90)
    assert L.stage_of(today=T, signup_day=old, log_days=days(15)) == "lapsed"
    assert L.stage_of(today=T, signup_day=old, log_days=days(14)) == "lapsing"
    assert L.stage_of(today=T, signup_day=old, log_days=days(3)) == "lapsing"
    assert L.stage_of(today=T, signup_day=old, log_days=set()) == "lapsed"


def test_stage_returning_for_seven_days_after_a_gap_of_three() -> None:
    old = T - timedelta(days=90)
    # Logged 10 days ago, then nothing until 5 days ago, and yesterday.
    back = days(10, 5, 1)
    assert L.stage_of(today=T, signup_day=old, log_days=back) == "returning"
    # The return was 7 days ago: no longer returning.
    stale = days(12, 7, 6, 5, 4, 3, 2, 1)
    assert L.stage_of(today=T, signup_day=old, log_days=stale) != "returning"


def test_stage_returning_is_checked_before_steady() -> None:
    old = T - timedelta(days=90)
    # Eight of the last 14 days, but the latest run began after a 3-day gap.
    log = days(0, 1, 2, 3, 4, 8, 9, 10, 11, 12)
    assert L.stage_of(today=T, signup_day=old, log_days=log) == "returning"


def test_stage_steady_and_drifting() -> None:
    old = T - timedelta(days=90)
    assert L.stage_of(today=T, signup_day=old, log_days=days(*range(8))) == "steady"
    # 0, 2, .., 14: day 14 is outside the 14-day window, so only 7 count.
    assert (
        L.stage_of(today=T, signup_day=old, log_days=days(*range(0, 16, 2)))
        == "drifting"
    )
    assert L.stage_of(today=T, signup_day=old, log_days=days(0, 2, 4)) == "drifting"


# ---------------------------------------------------------------- risk


def test_risk_points_for_days_since_last_log() -> None:
    old = T - timedelta(days=90)
    base: dict[str, object] = {
        "today": T,
        "signup_day": old,
        "ignore_streak": 0,
        "areas_28d": 2,
    }
    for since, pts in ((0, 0), (1, 10), (2, 25), (3, 40), (4, 40), (5, 55)):
        lg = days(since, since + 1, since + 2)  # no slowdown
        assert L.risk_score(log_days=lg, **base) == pts, since  # type: ignore[arg-type]
    # Nothing in the last 7 days after a log in the 21 before: also slowing.
    assert L.risk_score(log_days=days(8), **base) == 80  # type: ignore[arg-type]
    assert L.risk_score(log_days=set(), **base) == 70  # type: ignore[arg-type]


def test_risk_adds_slowing_ignores_one_area_and_a_silent_first_day() -> None:
    old = T - timedelta(days=90)
    # 9 log days in the previous 21 (3 per week), 1 in the last 7: slowing.
    slow = days(0, *range(7, 28, 2))
    assert (
        L.risk_score(
            today=T, signup_day=old, log_days=slow, ignore_streak=3, areas_28d=1
        )
        == 0 + 10 + 10 + 5
    )
    new = T - timedelta(days=5)
    assert (
        L.risk_score(
            today=T, signup_day=new, log_days=days(0), ignore_streak=0, areas_28d=2
        )
        == 5
    )


# ---------------------------------------------------------------- ladder, ignores


def test_ladder_steps_on_days_3_7_14_and_30_for_loyal_people() -> None:
    assert [L.ladder_kind(d, lifetime_log_days=10) for d in range(0, 32)] == [
        "ladder_3"
        if d == 3
        else "ladder_7"
        if d == 7
        else "ladder_14"
        if d == 14
        else "ladder_30"
        if d == 30
        else None
        for d in range(0, 32)
    ]
    assert L.ladder_kind(30, lifetime_log_days=6) is None


def test_ignore_streak_counts_consecutive_unopened_nudges() -> None:
    now = NOW
    sent = [now - timedelta(days=k) for k in (1, 2, 3, 4)]
    ignored = [(s, None) for s in sent]
    assert L.ignore_streak(ignored, app_opens=[], now=now) == 4
    # The second-newest was opened: the streak stops there.
    mixed = [(sent[0], None), (sent[1], sent[1] + timedelta(minutes=5)), *ignored[2:]]
    assert L.ignore_streak(mixed, app_opens=[], now=now) == 1
    # An app open within 2 h of the newest counts as not ignored.
    assert (
        L.ignore_streak(ignored, app_opens=[sent[0] + timedelta(minutes=90)], now=now)
        == 0
    )
    # Opened late still counts as opened (the tap cleared the streak).
    late = [(sent[0], sent[0] + timedelta(hours=7))]
    assert L.ignore_streak(late, app_opens=[], now=now) == 0


def test_a_nudge_younger_than_6_hours_is_not_judged_yet() -> None:
    fresh = [(NOW - timedelta(hours=1), None), (NOW - timedelta(days=1), None)]
    assert L.ignore_streak(fresh, app_opens=[], now=NOW) == 1


def test_backoff_waits_2_to_the_k_minus_1_extra_days() -> None:
    last = date(2026, 11, 10)
    assert L.next_nudge_after(last, 0) is None
    assert L.next_nudge_after(last, 1) == last + timedelta(days=2)  # +1 extra
    assert L.next_nudge_after(last, 2) == last + timedelta(days=4)  # +3
    assert L.next_nudge_after(last, 3) == last + timedelta(days=8)  # +7
    assert L.next_nudge_after(None, 3) is None


# ---------------------------------------------------------------- arm


def test_arm_is_stable_and_about_one_in_ten_is_held_out() -> None:
    ids = [uuid.UUID(int=i * 7919) for i in range(2000)]
    arms = [L.arm_of(u) for u in ids]
    assert arms == [L.arm_of(u) for u in ids]
    share = arms.count("holdout") / len(arms)
    assert 0.07 < share < 0.13
    assert set(arms) == {"holdout", "treated"}


# ---------------------------------------------------------------- the decision


def maybe(**kw: object) -> L.Decision | None:
    base: dict[str, object] = {
        "mode": "daily",
        "stage": "steady",
        "days_since_log": 1,
        "lifetime_log_days": 20,
        "active_today": False,
        "in_quiet": False,
        "ignore_streak": 0,
        "next_nudge_after": None,
        "today": T,
        "sent_last_7": 0,
        "reminders_today": 0,
        "has_content": True,
        "holdout": False,
    }
    base.update(kw)
    return L.decide(**base)  # type: ignore[arg-type]


def decide(**kw: object) -> L.Decision:
    d = maybe(**kw)
    assert d is not None
    return d


def test_a_steady_person_quiet_today_gets_the_best_time_nudge() -> None:
    assert decide() == L.Decision("best_time", None)


def test_off_sends_nothing() -> None:
    assert decide(mode="off") == L.Decision("best_time", "opt_out")


def test_logged_or_opened_today_is_skipped() -> None:
    assert decide(days_since_log=0) == L.Decision("best_time", "active_today")
    assert decide(active_today=True) == L.Decision("best_time", "active_today")
    assert decide(days_since_log=3, active_today=True) == L.Decision(
        "ladder_3", "active_today"
    )


def test_between_ladder_steps_nothing_is_considered() -> None:
    for d in (2, 4, 5, 6, 8, 13, 15, 29, 31, 60):
        assert maybe(days_since_log=d, stage="lapsing") is None, d


def test_never_logged_is_treated_as_a_best_time_day() -> None:
    assert decide(days_since_log=None, stage="new") == L.Decision("best_time", None)


def test_quiet_backoff_fatigue_and_budget_suppress() -> None:
    assert decide(in_quiet=True).suppressed == "quiet"
    assert decide(ignore_streak=4).suppressed == "fatigue"
    assert decide(
        ignore_streak=2, next_nudge_after=T + timedelta(days=1)
    ).suppressed == ("backoff")
    assert decide(ignore_streak=2, next_nudge_after=T).suppressed is None
    # The ladder is not held by backoff: day 14's note still goes out.
    assert (
        decide(
            days_since_log=14,
            stage="lapsing",
            ignore_streak=3,
            next_nudge_after=T + timedelta(days=1),
        ).suppressed
        is None
    )
    assert decide(sent_last_7=4).suppressed == "budget"
    assert decide(sent_last_7=3).suppressed is None
    assert decide(stage="lapsing", days_since_log=3, sent_last_7=3).suppressed == (
        "budget"
    )
    assert decide(mode="weekly", sent_last_7=1).suppressed == "budget"
    assert decide(mode="weekly", sent_last_7=0).suppressed is None
    assert decide(reminders_today=4).suppressed == "budget"


def test_no_content_then_holdout_come_last() -> None:
    assert decide(has_content=False).suppressed == "no_content"
    assert decide(holdout=True) == L.Decision("best_time", "holdout")
    # Holdout records only what would really have gone out.
    assert decide(holdout=True, mode="off").suppressed == "opt_out"


# ---------------------------------------------------------------- grace


def walk(*hits: bool | None, start: date = date(2026, 11, 1)):  # type: ignore[no-untyped-def]
    return walk_run((start + timedelta(days=i), h) for i, h in enumerate(hits))


def test_grace_ready_when_a_run_has_no_grace_day_in_the_last_week() -> None:
    w = walk(True, True, True)  # Nov 1-3
    assert grace_ready(w.current, w.grace_days, date(2026, 11, 4))
    used = walk(True, True, False, True)  # grace on Nov 3
    assert not grace_ready(used.current, used.grace_days, date(2026, 11, 5))
    later = date(2026, 11, 3) + timedelta(days=GRACE_GAP_DAYS)
    assert grace_ready(used.current, used.grace_days, later)
    assert not grace_ready(0, [], date(2026, 11, 4))


def test_grace_ready_agrees_with_the_walk_bridging_a_miss_today() -> None:
    """Whenever grace_ready says a rest day is there, a miss on that day and
    a hit the day after keep the run; whenever it says no, they end it."""
    import itertools

    for pattern in itertools.product((True, False, None), repeat=7):
        w = walk(*pattern)
        today = date(2026, 11, 1) + timedelta(days=7)
        ready = grace_ready(w.current, w.grace_days, today)
        after = walk(*pattern, False, True)
        if w.current == 0:
            assert not ready
            continue
        if (
            pattern[-1] is False
            and w.grace_days
            and w.grace_days[-1] == today - timedelta(days=1)
        ):
            # Yesterday's miss is held: a second miss in a row ends the run.
            assert not ready
        assert (after.current == w.current + 1) == ready, pattern
