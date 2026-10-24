"""The focus timer's rules (ADR-0025) over hand-computed timelines: every
expected instant and total below is worked out from the lengths in the
test, never read back from the module."""

import uuid
from datetime import date, datetime, timedelta, timezone

from app.modules.focus import logic as L
from app.shared.day import DayClock

T = datetime(2026, 10, 20, 1, 0, tzinfo=timezone.utc)  # 09:00 in Manila
M = timedelta(minutes=1)
TASK = L.Item("task", uuid.UUID(int=1), "Write the ADR")
HABIT = L.Item("habit", uuid.UUID(int=2), "Read")


def ids() -> L.NewId:
    n = iter(range(100, 10_000))
    return lambda: uuid.UUID(int=next(n))


def pomodoro(*, auto_breaks: bool = True, auto_focus: bool = False, item: L.Item | None = TASK,
             lengths: tuple[int, int, int, int] = (25, 5, 15, 4)) -> L.Timeline:  # fmt: skip
    return L.start(
        session_id=uuid.UUID(int=9),
        segment_id=uuid.UUID(int=10),
        mode="pomodoro",
        lengths=lengths,
        auto_start_breaks=auto_breaks,
        auto_start_focus=auto_focus,
        item=item,
        now=T,
    )


def stopwatch() -> L.Timeline:
    return L.start(
        session_id=uuid.UUID(int=9), segment_id=uuid.UUID(int=10), mode="stopwatch",
        lengths=(25, 5, 15, 4), auto_start_breaks=False, auto_start_focus=False,
        item=None, now=T,
    )  # fmt: skip


def kinds(tl: L.Timeline) -> list[tuple[str, int, datetime, datetime | None]]:
    return [(s.kind, s.set_index, s.started_at, s.ended_at) for s in tl.segs]


# ---------------------------------------------------------------- the clock


def test_a_running_set_counts_down_from_its_start() -> None:
    p = L.phase(L.advance(pomodoro(), T + 10 * M), T + 10 * M)
    assert (p.status, p.kind, p.set_index) == ("running", "focus", 0)
    assert p.elapsed == 600 and p.remaining == 900
    assert p.ends_at == T + 25 * M


def test_a_finished_set_closes_on_its_instant_and_the_break_starts_there() -> None:
    tl = L.advance(pomodoro(), T + 26 * M)
    assert kinds(tl) == [("focus", 0, T, T + 25 * M), ("break", 0, T + 25 * M, None)]
    assert tl.segs[1].planned_sec == 300
    p = L.phase(tl, T + 26 * M)
    assert (p.status, p.kind, p.remaining) == ("running", "break", 240)


def test_without_auto_start_the_timer_waits_for_the_break() -> None:
    tl = L.advance(pomodoro(auto_breaks=False), T + 40 * M)
    assert kinds(tl) == [("focus", 0, T, T + 25 * M)]
    p = L.phase(tl, T + 40 * M)
    assert (p.status, p.kind, p.set_index, p.remaining) == ("waiting", "break", 0, 300)


def test_after_a_short_break_without_auto_focus_it_waits_for_the_next_set() -> None:
    tl = L.advance(pomodoro(), T + 45 * M)
    assert kinds(tl)[-1] == ("break", 0, T + 25 * M, T + 30 * M)
    p = L.phase(tl, T + 45 * M)
    assert (p.status, p.kind, p.set_index) == ("waiting", "focus", 1)


def test_auto_start_runs_one_round_and_stops_at_the_long_break() -> None:
    # 4 x 25 focus + 3 x 5 short + 15 long = 130 minutes; look a day later.
    tl = L.advance(pomodoro(auto_focus=True), T + timedelta(days=1))
    assert [k[:2] for k in kinds(tl)] == [
        ("focus", 0), ("break", 0), ("focus", 1), ("break", 1),
        ("focus", 2), ("break", 2), ("focus", 3), ("break", 3),
    ]  # fmt: skip
    assert tl.segs[-1].ended_at == T + 130 * M
    assert tl.segs[-1].planned_sec == 15 * 60
    p = L.phase(tl, T + timedelta(days=1))
    assert (p.status, p.kind, p.set_index) == ("waiting", "focus", 4)
    assert L.sets_completed(tl, T + timedelta(days=1)) == 4
    assert L.focus_sec(tl, T + timedelta(days=1)) == 100 * 60


def test_the_auto_opened_rows_have_the_ids_both_sides_mint() -> None:
    tl = L.advance(pomodoro(auto_focus=True), T + 31 * M)
    sid = uuid.UUID(int=9)
    assert tl.segs[1].id == L.auto_id(sid, "break", 0)
    assert tl.segs[2].id == L.auto_id(sid, "focus", 1)
    assert L.auto_id(sid, "break", 0) == L.auto_id(sid, "break", 0)
    assert tl.segs[2].item == TASK


# ---------------------------------------------------------------- actions


def test_a_pause_is_an_interval_and_pushes_the_set_end_back() -> None:
    new = ids()
    tl = L.pause(pomodoro(), T + 10 * M, new)
    tl = L.resume(tl, T + 15 * M, new)
    assert kinds(tl) == [
        ("focus", 0, T, T + 10 * M),
        ("pause", 0, T + 10 * M, T + 15 * M),
        ("focus", 0, T + 15 * M, None),
    ]
    p = L.phase(L.advance(tl, T + 20 * M), T + 20 * M)
    assert p.elapsed == 15 * 60 and p.ends_at == T + 30 * M
    done = L.advance(tl, T + 31 * M)
    assert done.segs[2].ended_at == T + 30 * M
    assert L.focus_sec(done, T + 31 * M) == 25 * 60


def test_paused_time_does_not_run_the_clock() -> None:
    tl = L.pause(pomodoro(), T + 10 * M, ids())
    p = L.phase(L.advance(tl, T + 3 * 60 * M), T + 3 * 60 * M)
    assert (p.status, p.kind, p.elapsed, p.remaining) == ("paused", "focus", 600, 900)


def test_pausing_a_break_resumes_the_break() -> None:
    new = ids()
    tl = L.pause(L.advance(pomodoro(), T + 27 * M), T + 27 * M, new)
    tl = L.resume(tl, T + 40 * M, new)
    assert kinds(tl)[-1][:2] == ("break", 0)
    p = L.phase(tl, T + 40 * M)
    assert p.kind == "break" and p.remaining == 180


def test_switching_mid_set_splits_the_time_between_items() -> None:
    tl = L.switch(pomodoro(), T + 10 * M, HABIT, ids())
    assert [(s.kind, s.item) for s in tl.segs] == [("focus", TASK), ("focus", HABIT)]
    assert tl.sess.item == HABIT
    done = L.advance(tl, T + 26 * M)
    spans = L.counted([done], T + 26 * M)
    by = L.per_item(spans)
    assert by[("task", TASK.id)] == 600 and by[("habit", HABIT.id)] == 900
    assert L.sets_completed(done, T + 26 * M) == 1


def test_switching_while_paused_relabels_the_pause_and_the_resumed_focus() -> None:
    new = ids()
    tl = L.pause(pomodoro(), T + 5 * M, new)
    tl = L.switch(tl, T + 6 * M, HABIT, new)
    tl = L.resume(tl, T + 7 * M, new)
    assert [s.item for s in tl.segs] == [TASK, HABIT, HABIT]


def test_switching_to_nothing() -> None:
    tl = L.switch(pomodoro(), T + 5 * M, None, ids())
    assert tl.segs[-1].item is None and tl.sess.item is None


def test_extending_a_set_moves_its_end() -> None:
    tl = L.extend(pomodoro(), T + 20 * M, 5 * 60)
    assert L.phase(tl, T + 20 * M).ends_at == T + 30 * M
    assert L.advance(tl, T + 31 * M).segs[0].ended_at == T + 30 * M


def test_skipping_a_break_starts_the_next_set_now() -> None:
    tl = L.skip_break(L.advance(pomodoro(), T + 27 * M), T + 27 * M, ids())
    assert kinds(tl)[-2:] == [
        ("break", 0, T + 25 * M, T + 27 * M),
        ("focus", 1, T + 27 * M, None),
    ]
    assert tl.segs[-1].item == TASK


def test_skipping_a_break_the_timer_is_waiting_on() -> None:
    tl = L.skip_break(
        L.advance(pomodoro(auto_breaks=False), T + 30 * M), T + 30 * M, ids()
    )
    assert kinds(tl)[-1] == ("focus", 1, T + 30 * M, None)


def test_start_next_begins_what_the_timer_waits_on() -> None:
    tl = L.start_next(
        L.advance(pomodoro(auto_breaks=False), T + 30 * M), T + 30 * M, ids()
    )
    assert kinds(tl)[-1] == ("break", 0, T + 30 * M, None)
    assert tl.segs[-1].item is None


def test_ending_early_keeps_the_partial_set() -> None:
    tl = L.stop(pomodoro(), T + 12 * M)
    assert tl.sess.ended_at == T + 12 * M and tl.sess.end_reason == "completed"
    assert L.focus_sec(tl, T + 12 * M) == 720 and L.sets_completed(tl, T + 12 * M) == 0
    assert len(L.counted([tl], T + 13 * M)) == 1


def test_under_a_minute_is_an_accidental_tap() -> None:
    assert L.stop(pomodoro(), T + timedelta(seconds=59)).sess.end_reason == "abandoned"
    assert L.stop(pomodoro(), T + timedelta(seconds=60)).sess.end_reason == "completed"


def test_an_abandoned_session_counts_nowhere() -> None:
    tl = L.stop(pomodoro(), T + 20 * M, abandon=True)
    assert tl.sess.end_reason == "abandoned"
    assert L.counted([tl], T + 21 * M) == []


def test_actions_on_an_ended_session_change_nothing() -> None:
    tl = L.stop(pomodoro(), T + 20 * M)
    for out in (L.pause(tl, T + 30 * M, ids()), L.resume(tl, T + 30 * M, ids()),
                L.extend(tl, T + 30 * M, 60), L.stop(tl, T + 40 * M)):  # fmt: skip
        assert out.segs == tl.segs and out.sess.ended_at == T + 20 * M


# ---------------------------------------------------------------- caps


def test_a_stopwatch_has_no_target_and_stops_at_twelve_hours() -> None:
    p = L.phase(L.advance(stopwatch(), T + 3 * 60 * M), T + 3 * 60 * M)
    assert p.remaining is None and p.elapsed == 3 * 3600
    tl = L.advance(stopwatch(), T + 13 * 60 * M)
    assert tl.segs[0].ended_at == T + 12 * 60 * M
    assert tl.sess.ended_at == T + 12 * 60 * M and tl.sess.end_reason == "completed"
    assert L.sets_completed(tl, T + 13 * 60 * M) == 0


def test_a_pause_nobody_resumed_ends_the_session_at_the_cap() -> None:
    tl = L.advance(L.pause(stopwatch(), T + 30 * M, ids()), T + timedelta(days=2))
    assert tl.sess.ended_at == T + 30 * M + L.MAX_OPEN
    assert L.focus_sec(tl, T + timedelta(days=2)) == 30 * 60


# ---------------------------------------------------------------- two devices


def test_two_open_segments_close_where_the_next_begins() -> None:
    a = L.Seg(uuid.UUID(int=1), "focus", T, None, 0, 1500)
    b = L.Seg(uuid.UUID(int=2), "pause", T + 5 * M, None, 0, 1500)
    out = L.normalise([b, a])
    assert [(s.id.int, s.ended_at) for s in out] == [(1, T + 5 * M), (2, None)]


def test_overlapping_sessions_count_the_time_once() -> None:
    clock = DayClock()
    a = L.stop(stopwatch(), T + 60 * M)
    b = L.Timeline(
        L.Sess(uuid.UUID(int=20), "stopwatch", T + 30 * M, ended_at=T + 90 * M,
               end_reason="completed"),
        (L.Seg(uuid.UUID(int=21), "focus", T + 30 * M, T + 90 * M),),
    )  # fmt: skip
    day = clock.day_of(T)
    assert L.per_day(L.counted([a, b], T + 2 * 60 * M), clock, day, day) == {
        day: 90 * 60
    }


# ---------------------------------------------------------------- business days


def manila(y: int, mo: int, d: int, h: int, mi: int = 0) -> datetime:
    return datetime(y, mo, d, h, mi, tzinfo=timezone(timedelta(hours=8)))


def span(a: datetime, b: datetime) -> L.Focused:
    return L.Focused(a, b, None, uuid.UUID(int=1))


def test_a_span_across_the_four_am_boundary_splits_between_days() -> None:
    clock = DayClock()  # Asia/Manila, day starts 04:00
    s = span(manila(2026, 10, 21, 3, 30), manila(2026, 10, 21, 4, 30))
    out = L.per_day([s], clock, date(2026, 10, 20), date(2026, 10, 21))
    assert out == {date(2026, 10, 20): 1800, date(2026, 10, 21): 1800}


def test_a_span_across_midnight_stays_on_one_business_day() -> None:
    clock = DayClock()
    s = span(manila(2026, 10, 20, 23, 30), manila(2026, 10, 21, 0, 30))
    out = L.per_day([s], clock, date(2026, 10, 20), date(2026, 10, 21))
    assert out == {date(2026, 10, 20): 3600, date(2026, 10, 21): 0}


def test_another_day_start_hour_moves_the_split() -> None:
    clock = DayClock(start_hour=0)
    s = span(manila(2026, 10, 20, 23, 30), manila(2026, 10, 21, 0, 30))
    out = L.per_day([s], clock, date(2026, 10, 20), date(2026, 10, 21))
    assert out == {date(2026, 10, 20): 1800, date(2026, 10, 21): 1800}


def test_union_merges_touching_and_drops_empty_spans() -> None:
    a, b, c = T, T + 10 * M, T + 20 * M
    assert L.union([(b, c), (a, b), (c, c)]) == [(a, c)]


def test_goal_streak_counts_back_from_yesterday_until_today_is_hit() -> None:
    today = date(2026, 10, 24)
    by = {today - timedelta(days=i): 7200 for i in (1, 2, 3)}
    assert L.goal_streak(by, 7200, today) == 3
    by[today] = 7200
    assert L.goal_streak(by, 7200, today) == 4
    by.pop(today - timedelta(days=2))
    assert L.goal_streak(by, 7200, today) == 2
    assert L.goal_streak(by, 0, today) == 0


def test_hours_and_minutes() -> None:
    assert [L.fmt_hm(s) for s in (0, 59, 60, 3599, 3600, 3900, 36000)] == [
        "0m", "0m", "1m", "59m", "1h 00m", "1h 05m", "10h 00m",
    ]  # fmt: skip


def test_presets() -> None:
    assert L.PRESETS["25-5"] == (25, 5, 15, 4)
    assert L.PRESETS["50-10"][:2] == (50, 10)
    assert L.PRESETS["90-20"][:2] == (90, 20)
