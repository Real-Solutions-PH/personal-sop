"""Which topic the best-time nudge is about: the person's state, the time of
day and their persona (retention/topics.py; pure)."""

import pytest

from app.modules.retention import topics as T
from app.modules.retention.topics import Candidate

HABIT = Candidate("habit_due", "/habits/h1", "Read 10 pages")
TASK = Candidate("task_due", "/tasks/task/t1", "Call the dentist")
BILL = Candidate("bill_due", "/finance/planned/p1")
BEST = Candidate("near_best", "/habits/h1", "Read 10 pages", count=30)
USUAL = Candidate("habit_usual", "/habits/h1", "Read 10 pages")
WRAP = Candidate("wrap_up", "/today/wrap-up", done=3, due=5)
PLAN_TOMORROW = Candidate("plan_tomorrow", "/plan")
PLAN_TODAY = Candidate("plan_today", "/plan")
WEIGH = Candidate("weigh_in", "/fitness/body", count=9)
EVENING = 18 * 60


# ---------------------------------------------------------------- helpers


@pytest.mark.parametrize(
    ("minute", "phase"),
    [
        (7 * 60, "morning"),
        (11 * 60 + 59, "morning"),
        (12 * 60, "day"),
        (17 * 60 + 59, "day"),
        (18 * 60, "evening"),
        (21 * 60, "evening"),
    ],
)
def test_phase_of_the_day(minute: int, phase: str) -> None:
    assert T.phase_of(minute, EVENING) == phase


def test_evening_starts_when_the_person_says() -> None:
    assert T.phase_of(16 * 60, 16 * 60) == "evening"
    assert T.phase_of(19 * 60, 20 * 60) == "day"


@pytest.mark.parametrize(
    ("current", "expected"),
    [(6, 7), (29, 30), (99, 100), (364, 365), (0, None), (7, None), (12, None)],
)
def test_next_milestone_is_one_tick_away(current: int, expected: int | None) -> None:
    assert T.next_milestone(current) == expected


def test_usual_minute_needs_three_logs_and_takes_the_median() -> None:
    assert T.usual_minute([1200, 1210]) is None
    assert T.usual_minute([1200, 1230, 600]) == 1200
    assert T.usual_minute([420, 430, 440, 1300]) == 440


def test_near_wraps_midnight() -> None:
    assert T.near(1430, 10)  # 23:50 vs 00:10
    assert T.near(1200, 1260)
    assert not T.near(1200, 1261)


@pytest.mark.parametrize(
    ("days", "due"), [(None, False), (6, False), (7, True), (60, True), (61, False)]
)
def test_weigh_in_due_after_a_week_until_two_months(
    days: int | None, due: bool
) -> None:
    assert T.weigh_in_due(days) is due


@pytest.mark.parametrize(("since", "day"), [(0, None), (1, 2), (6, 7), (7, None)])
def test_first_week_days_two_to_seven(since: int, day: int | None) -> None:
    assert T.first_week_day(since) == day


# ---------------------------------------------------------------- pick


def _pick(
    cands: list[Candidate],
    *,
    phase: T.Phase = "day",
    archetype: str | None = None,
    secondary: str | None = None,
    recent: set[str] | None = None,
) -> str | None:
    c = T.pick(
        cands,
        phase=phase,
        archetype=archetype,
        secondary=secondary,
        recent=recent or set(),
    )
    return c.topic if c else None


def test_nothing_to_pick() -> None:
    assert _pick([]) is None


def test_a_bill_due_beats_everything() -> None:
    every = [HABIT, TASK, BEST, USUAL, WRAP, PLAN_TOMORROW, WEIGH, BILL]
    assert _pick(every, phase="evening", archetype="habit-builder") == "bill_due"


def test_one_short_of_a_milestone_beats_the_plain_next_habit() -> None:
    assert _pick([HABIT, BEST]) == "near_best"
    assert _pick([HABIT, USUAL]) == "habit_usual"


def test_evening_and_morning_topics_only_in_their_part_of_the_day() -> None:
    assert _pick([WRAP, PLAN_TOMORROW, HABIT], phase="day") == "habit_due"
    assert _pick([PLAN_TODAY, HABIT], phase="evening") == "habit_due"
    assert _pick([PLAN_TODAY, HABIT], phase="morning") == "plan_today"
    assert _pick([WRAP, HABIT], phase="evening") == "wrap_up"


def test_persona_tips_the_balance() -> None:
    """A planner's evening goes to tomorrow's plan; a habit-builder's to the
    habit one tick from 30 days; someone without a persona yet gets the
    milestone too (it ranks higher on its own)."""
    evening = [BEST, WRAP, PLAN_TOMORROW]
    assert _pick(evening, phase="evening", archetype="planner") == "plan_tomorrow"
    assert _pick(evening, phase="evening", archetype="habit-builder") == "near_best"
    assert _pick(evening, phase="evening") == "near_best"
    # A body-tracker gets the weigh-in over the next habit or task.
    assert _pick([HABIT, TASK, WEIGH], archetype="body-tracker") == "weigh_in"
    # A planner's plain next task beats a plain next habit.
    assert _pick([HABIT, TASK], archetype="planner") == "task_due"
    assert _pick([HABIT, TASK], archetype="habit-builder") == "habit_due"


def test_the_secondary_persona_counts_for_less() -> None:
    assert (
        _pick([HABIT, TASK], archetype="money-tracker", secondary="planner")
        == "task_due"
    )
    # Primary beats secondary.
    assert (
        _pick([HABIT, TASK], archetype="habit-builder", secondary="planner")
        == "habit_due"
    )


def test_a_topic_sent_in_the_last_two_days_steps_back() -> None:
    assert _pick([BEST, USUAL]) == "near_best"
    assert _pick([BEST, USUAL], recent={"near_best"}) == "habit_usual"
    # Still picked when it is the only thing to say.
    assert _pick([USUAL], recent={"habit_usual"}) == "habit_usual"


def test_ties_keep_the_topic_order_then_the_candidate_order() -> None:
    assert _pick([TASK, HABIT]) == "habit_due"
    second = Candidate("habit_due", "/habits/h2", "Stretch")
    picked = T.pick([HABIT, second], phase="day", archetype=None, secondary=None)
    assert picked is HABIT
