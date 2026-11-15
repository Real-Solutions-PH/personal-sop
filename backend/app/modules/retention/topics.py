"""What the day's best-time nudge is about, chosen from the person's own
state and persona (docs/26-retention-algorithms.md §3.1, §3.4, §3.7):
pure, no database, no clock of its own.

The sender gathers the candidates that are true today (a bill due, a habit
one day short of a milestone, a habit usually done around now, tomorrow
still empty, a wrap-up not done, a weigh-in a week old, a first-week day,
the first due habit or task); :func:`pick` scores them by a fixed priority,
the time of day, the person's archetype (what they mostly use Unfurl for)
and whether the same topic went out in the last two days, and returns the
one to send. Ties keep the order of :data:`TOPICS`.

The comeback ladder (days 3, 7, 14, 30 after the last log) is not here: it
has its own copy and schedule (``copy.render``).
"""

from collections.abc import Collection, Sequence
from dataclasses import dataclass
from typing import Literal

Topic = Literal[
    "bill_due",
    "near_best",
    "wrap_up",
    "plan_tomorrow",
    "plan_today",
    "habit_usual",
    "weigh_in",
    "first_week",
    "habit_due",
    "task_due",
]
Phase = Literal["morning", "day", "evening"]

TOPICS: tuple[Topic, ...] = (
    "bill_due",
    "near_best",
    "wrap_up",
    "plan_tomorrow",
    "plan_today",
    "habit_usual",
    "weigh_in",
    "first_week",
    "habit_due",
    "task_due",
)

# Fixed priority before persona and freshness: a bill due beats everything,
# a plain "next habit" is the fallback.
BASE: dict[Topic, int] = {
    "bill_due": 100,
    "near_best": 70,
    "wrap_up": 60,
    "plan_tomorrow": 55,
    "plan_today": 55,
    "habit_usual": 50,
    "weigh_in": 45,
    "first_week": 40,
    "habit_due": 30,
    "task_due": 30,
}
# The area a topic belongs to, for the archetype bias (None: every area).
AREA: dict[Topic, str | None] = {
    "bill_due": "finance",
    "near_best": "habits",
    "wrap_up": None,
    "plan_tomorrow": "tasks",
    "plan_today": "tasks",
    "habit_usual": "habits",
    "weigh_in": "fitness",
    "first_week": None,
    "habit_due": "habits",
    "task_due": "tasks",
}
# When in the day a topic makes sense (others: any time).
ONLY_IN: dict[Topic, Phase] = {
    "wrap_up": "evening",
    "plan_tomorrow": "evening",
    "plan_today": "morning",
}
# What each archetype (logic.ARCHETYPES) mostly logs.
ARCHETYPE_AREAS: dict[str, frozenset[str]] = {
    "habit-builder": frozenset({"habits"}),
    "planner": frozenset({"tasks"}),
    "money-tracker": frozenset({"finance"}),
    "body-tracker": frozenset({"fitness", "nutrition"}),
    "deep-worker": frozenset({"focus"}),
    "reflector": frozenset({"journal"}),
}
PRIMARY_BONUS = 25
SECONDARY_BONUS = 10
# A topic sent in the last two days steps back so the nudge doesn't repeat.
REPEAT_PENALTY = 30

MORNING_END = 12 * 60
# A habit counts as "usually done around now" within this many minutes of
# its median log time, from at least this many logs in 28 days.
USUAL_WINDOW = 60
USUAL_MIN_LOGS = 3
# A weigh-in nudge goes to someone who weighed in before, 7 to 60 days ago.
WEIGH_IN_AFTER = 7
WEIGH_IN_UNTIL = 60
FIRST_WEEK_DAYS = 7
# Streak lengths worth one more day's tick.
MILESTONES = (7, 14, 21, 30, 50, 75, 100, 150, 200, 250, 300, 365, 500, 730, 1000)


@dataclass(frozen=True)
class Candidate:
    topic: Topic
    href: str
    # The habit or task the nudge names (the person's own words), if any.
    title: str = ""
    # near_best: the streak it makes; weigh_in: days since the last one;
    # first_week: the day number.
    count: int = 0
    # wrap_up: today's done and due habits and tasks.
    done: int = 0
    due: int = 0
    # bill_due: today or tomorrow.
    tomorrow: bool = False
    # habit_due: a rest day is ready on its streak.
    rest_ready: bool = False


def phase_of(minute: int, evening_start: int) -> Phase:
    """Morning before noon, evening from the person's own evening start."""
    if minute >= evening_start:
        return "evening"
    if minute < MORNING_END:
        return "morning"
    return "day"


def next_milestone(current: int) -> int | None:
    """The milestone one more day's tick reaches, if it is one."""
    n = current + 1
    return n if n in MILESTONES else None


def usual_minute(minutes: Sequence[int]) -> int | None:
    """The median local minute a habit is logged at, from enough logs."""
    if len(minutes) < USUAL_MIN_LOGS:
        return None
    ordered = sorted(minutes)
    return ordered[len(ordered) // 2]


def near(minute: int, usual: int, window: int = USUAL_WINDOW) -> bool:
    diff = abs(minute - usual) % 1440
    return min(diff, 1440 - diff) <= window


def weigh_in_due(days_since: int | None) -> bool:
    return days_since is not None and WEIGH_IN_AFTER <= days_since <= WEIGH_IN_UNTIL


def first_week_day(days_since_signup: int) -> int | None:
    """Day 2 to 7 of someone's first week (day 1 is onboarding's)."""
    n = days_since_signup + 1
    return n if 2 <= n <= FIRST_WEEK_DAYS else None


def score(
    c: Candidate,
    *,
    archetype: str | None,
    secondary: str | None,
    recent: Collection[str],
) -> int:
    pts = BASE[c.topic]
    area = AREA[c.topic]
    if area is not None:
        if archetype and area in ARCHETYPE_AREAS.get(archetype, ()):
            pts += PRIMARY_BONUS
        elif secondary and area in ARCHETYPE_AREAS.get(secondary, ()):
            pts += SECONDARY_BONUS
    if c.topic in recent:
        pts -= REPEAT_PENALTY
    return pts


def pick(
    candidates: Sequence[Candidate],
    *,
    phase: Phase,
    archetype: str | None,
    secondary: str | None,
    recent: Collection[str] = (),
) -> Candidate | None:
    """The candidate to send: the highest score among those that fit the
    time of day; on a tie, the earlier topic, then the earlier candidate."""
    best: tuple[int, int, int] | None = None
    out: Candidate | None = None
    for i, c in enumerate(candidates):
        only = ONLY_IN.get(c.topic)
        if only is not None and only != phase:
            continue
        key = (
            score(c, archetype=archetype, secondary=secondary, recent=recent),
            -TOPICS.index(c.topic),
            -i,
        )
        if best is None or key > best:
            best, out = key, c
    return out
