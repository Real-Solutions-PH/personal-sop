"""Pure habit and routine calculations, ported from
``shared/prototype/habits/logic.ts`` (the ratified behaviour).

Nothing here touches the database or the clock: callers pass ``today`` (the
business day from ``ctx.today``) and the user's time zone, and the views below
are built from rows by ``views.py``. The golden fixtures in
``tests/golden/habits-logic.json`` pin every function to the prototype's
output over its seed.
"""

import math
from collections.abc import Iterable, Sequence
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from typing import Literal
from zoneinfo import ZoneInfo

from app.shared.day import DEFAULT_DAY_START_HOUR, DEFAULT_TIMEZONE, js_weekday

Cell = Literal[
    "done",
    "partial",
    "skipped",
    "missed",
    "paused",
    "pending",
    "bonus",
    "none",
    "future",
]
TodayGroup = Literal["now", "later", "anytime", "done"]
RunState = Literal["in_progress", "completed", "abandoned"]

WEEKDAY_SHORT = ("Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat")
DEFAULT_WINDOW_MIN = 60
STREAK_MILESTONES = (7, 30, 100, 365)


@dataclass(frozen=True)
class Slot:
    days: tuple[int, ...]
    time: str | None = None
    window: int | None = None


@dataclass(frozen=True)
class Pause:
    from_day: date
    to_day: date | None = None


@dataclass(frozen=True)
class HabitView:
    id: str
    name: str
    type: str
    schedule: tuple[Slot, ...]
    created: date
    status: str = "active"
    pauses: tuple[Pause, ...] = ()
    archived: date | None = None
    sort_order: int = 0
    icon: str = ""
    target: float | None = None


@dataclass(frozen=True)
class LogView:
    habit_id: str
    day: date
    status: str
    logged_at: datetime
    value: float | None = None


@dataclass(frozen=True)
class StepView:
    habit_id: str
    minutes: int


@dataclass(frozen=True)
class ResultView:
    habit_id: str
    status: str
    actual_sec: int


@dataclass(frozen=True)
class RoutineView:
    id: str
    name: str
    schedule: tuple[Slot, ...]
    created: date
    status: str = "active"
    steps: tuple[StepView, ...] = ()
    icon: str = ""


@dataclass(frozen=True)
class RunView:
    id: str
    routine_id: str
    day: date
    state: str
    steps: tuple[StepView, ...] = ()
    results: tuple[ResultView, ...] = ()
    current: int = 0
    step_started_at: datetime | None = None
    paused_at: datetime | None = None
    step_paused_sec: float = 0


LogIndex = dict[tuple[str, date], LogView]


def log_index(logs: Iterable[LogView]) -> LogIndex:
    return {(lg.habit_id, lg.day): lg for lg in logs}


def js_round(x: float) -> int:
    """JavaScript ``Math.round``: halves round toward +infinity."""
    return math.floor(x + 0.5)


def days_between(first: date, last: date) -> list[date]:
    if last < first:
        return []
    return [first + timedelta(days=i) for i in range((last - first).days + 1)]


def slot_for(schedule: Sequence[Slot], day: date) -> Slot | None:
    wd = js_weekday(day)
    for slot in schedule:
        if wd in slot.days:
            return slot
    return None


def is_paused_on(h: HabitView, day: date) -> bool:
    return any(
        day >= p.from_day and (p.to_day is None or day <= p.to_day) for p in h.pauses
    )


def current_pause(h: HabitView, today: date) -> Pause | None:
    for p in h.pauses:
        if today >= p.from_day and (p.to_day is None or today <= p.to_day):
            return p
    return None


def effective_status(h: HabitView, today: date) -> str:
    if h.status == "archived":
        return "archived"
    return "paused" if is_paused_on(h, today) else "active"


def cell_for(h: HabitView, day: date, idx: LogIndex, today: date) -> Cell:
    if day < h.created:
        return "none"
    if h.archived is not None and day > h.archived:
        return "none"
    scheduled = slot_for(h.schedule, day) is not None
    if day > today:
        return "future" if scheduled and not is_paused_on(h, day) else "none"
    log = idx.get((h.id, day))
    if log is not None:
        if not scheduled:
            return "bonus"
        status: Cell = log.status  # type: ignore[assignment]
        return status
    if not scheduled:
        return "none"
    if is_paused_on(h, day):
        return "paused"
    return "pending" if day == today else "missed"


def is_due(h: HabitView, day: date) -> bool:
    return (
        h.status != "archived"
        and day >= h.created
        and slot_for(h.schedule, day) is not None
        and not is_paused_on(h, day)
    )


@dataclass
class HabitStats:
    scheduled: int = 0
    done: int = 0
    partial: int = 0
    skipped: int = 0
    missed: int = 0
    bonus: int = 0
    minutes: float = 0
    count_total: float = 0
    rate: float = 0.0
    skip_rate: float = 0.0
    on_time: float = 0.0


def _minute_of_day(at: datetime, zone: ZoneInfo) -> int:
    local = at.astimezone(zone)
    return local.hour * 60 + local.minute


def habit_stats(
    h: HabitView,
    idx: LogIndex,
    first: date,
    last: date,
    today: date,
    *,
    zone: ZoneInfo | None = None,
) -> HabitStats:
    """Rate is done / (scheduled - skipped); on time means logged from 60 min
    before the slot to ``window`` minutes after it (wall clock, user's zone)."""
    tz = zone or ZoneInfo(DEFAULT_TIMEZONE)
    s = HabitStats()
    timed = 0
    on_time = 0
    for day in days_between(first, min(last, today)):
        c = cell_for(h, day, idx, today)
        log = idx.get((h.id, day))
        if log is not None and log.value and log.status != "skipped":
            if h.type == "duration":
                s.minutes += log.value
            if h.type == "count":
                s.count_total += log.value
        if c in ("done", "partial", "skipped", "missed"):
            s.scheduled += 1
            setattr(s, c, getattr(s, c) + 1)
        if c == "bonus":
            s.bonus += 1
        if c in ("done", "partial") and log is not None:
            slot = slot_for(h.schedule, day)
            if slot is not None and slot.time:
                timed += 1
                hh, mm = (int(x) for x in slot.time.split(":"))
                diff = _minute_of_day(log.logged_at, tz) - (hh * 60 + mm)
                window = DEFAULT_WINDOW_MIN if slot.window is None else slot.window
                if -60 <= diff <= window:
                    on_time += 1
    denom = s.scheduled - s.skipped
    s.rate = s.done / denom if denom > 0 else 0.0
    s.skip_rate = s.skipped / s.scheduled if s.scheduled else 0.0
    s.on_time = on_time / timed if timed else 0.0
    return s


@dataclass(frozen=True)
class BrokenStreak:
    day: date
    length: int


@dataclass(frozen=True)
class Streaks:
    current: int
    best: int
    broken: list[BrokenStreak] = field(default_factory=list)


def streaks(h: HabitView, idx: LogIndex, today: date) -> Streaks:
    """Done and partial days extend a streak, missed days break it; skipped,
    paused, pending and unscheduled days are neutral."""
    current = 0
    d = today
    while d >= h.created:
        c = cell_for(h, d, idx, today)
        if c in ("done", "partial"):
            current += 1
        elif c == "missed":
            break
        d -= timedelta(days=1)
    best = 0
    run = 0
    broken: list[BrokenStreak] = []
    for day in days_between(h.created, today):
        c = cell_for(h, day, idx, today)
        if c in ("done", "partial"):
            run += 1
            best = max(best, run)
        elif c == "missed":
            if run >= 3:
                broken.append(BrokenStreak(day=day, length=run))
            run = 0
    return Streaks(current=current, best=best, broken=broken)


@dataclass(frozen=True)
class OverallDay:
    day: date
    due: int
    done: int
    rate: float | None


def overall_days(
    habits: Sequence[HabitView], idx: LogIndex, first: date, last: date, today: date
) -> list[OverallDay]:
    out: list[OverallDay] = []
    for day in days_between(first, last):
        due = 0
        done = 0
        for h in habits:
            c = cell_for(h, day, idx, today)
            if c in ("done", "partial", "missed", "pending"):
                due += 1
            if c == "done":
                done += 1
        out.append(
            OverallDay(day=day, due=due, done=done, rate=done / due if due else None)
        )
    return out


@dataclass(frozen=True)
class OverallStats:
    rate: float
    skip_rate: float
    minutes: float
    perfect: int
    missed: int
    done: int


def overall_stats(
    habits: Sequence[HabitView],
    idx: LogIndex,
    days: int,
    today: date,
    *,
    offset: int = 0,
    zone: ZoneInfo | None = None,
) -> OverallStats:
    """Every non-archived habit over ``days`` ending ``offset`` days ago.
    Perfect days never count today (it is not over yet)."""
    last = today - timedelta(days=offset)
    first = today - timedelta(days=offset + days - 1)
    hs = [h for h in habits if h.status != "archived"]
    done = denom = skipped = scheduled = missed = 0
    minutes: float = 0
    for h in hs:
        s = habit_stats(h, idx, first, last, today, zone=zone)
        done += s.done
        denom += s.scheduled - s.skipped
        skipped += s.skipped
        scheduled += s.scheduled
        minutes += s.minutes
        missed += s.missed
    perfect = sum(
        1
        for d in overall_days(hs, idx, first, min(last, today), today)
        if d.due > 0 and d.done == d.due and d.day != today
    )
    return OverallStats(
        rate=done / denom if denom else 0.0,
        skip_rate=skipped / scheduled if scheduled else 0.0,
        minutes=minutes,
        perfect=perfect,
        missed=missed,
        done=done,
    )


def to_min(hm: str) -> int:
    h, m = (int(x) for x in hm.split(":"))
    return h * 60 + m


def today_group(
    h: HabitView,
    log: LogView | None,
    day: date,
    now: datetime,
    *,
    zone: ZoneInfo | None = None,
    day_start_hour: int = DEFAULT_DAY_START_HOUR,
) -> TodayGroup:
    if log is not None and (log.status != "partial" or h.type == "check"):
        return "done"
    slot = slot_for(h.schedule, day)
    if slot is None or not slot.time:
        return "anytime"
    t = to_min(slot.time)
    local = now.astimezone(zone or ZoneInfo(DEFAULT_TIMEZONE))
    n = local.hour * 60 + local.minute
    if local.hour < day_start_hour:
        n += 24 * 60
    return "now" if n >= t - 30 else "later"


def planned_min(r: RoutineView) -> int:
    return sum(s.minutes for s in r.steps)


def run_state(run: RunView, today: date) -> RunState:
    """An unfinished run from a past day reads as abandoned."""
    if run.state == "in_progress" and run.day < today:
        return "abandoned"
    state: RunState = run.state  # type: ignore[assignment]
    return state


def run_actual_sec(run: RunView) -> int:
    return sum(r.actual_sec for r in run.results)


@dataclass(frozen=True)
class RoutineStats:
    runs: list[RunView]
    scheduled_days: int
    completed: int
    abandoned: list[RunView]
    rate: float
    pace: float


def routine_stats(
    r: RoutineView, runs: Sequence[RunView], days: int, today: date
) -> RoutineStats:
    first = today - timedelta(days=days - 1)
    mine = [x for x in runs if x.routine_id == r.id and x.day >= first]
    scheduled_days = 0
    for d in days_between(first, today):
        if d < r.created or slot_for(r.schedule, d) is None:
            continue
        if d == today and not any(x.day == d for x in mine):
            continue
        scheduled_days += 1
    completed = [x for x in mine if run_state(x, today) == "completed"]
    abandoned = [x for x in mine if run_state(x, today) == "abandoned"]
    paces: list[float] = []
    for x in completed:
        actual = run_actual_sec(x)
        planned = sum(
            s.minutes * 60
            for i, s in enumerate(x.steps)
            if i < len(x.results) and x.results[i].status == "done"
        )
        paces.append(actual / planned if planned else 1.0)
    return RoutineStats(
        runs=mine,
        scheduled_days=scheduled_days,
        completed=len(completed),
        abandoned=abandoned,
        rate=len(completed) / scheduled_days if scheduled_days else 0.0,
        pace=sum(paces) / len(paces) if paces else 0.0,
    )


def step_elapsed(
    step_started_at: datetime,
    now: datetime,
    *,
    paused_at: datetime | None = None,
    step_paused_sec: float = 0,
) -> float:
    """Seconds spent on the current step, excluding pauses."""
    end = paused_at or now
    return max(0.0, (end - step_started_at).total_seconds() - step_paused_sec)


def week_start_of(day: date, week_start: int) -> date:
    return day - timedelta(days=(js_weekday(day) - week_start + 7) % 7)


@dataclass(frozen=True)
class MostMissed:
    day: str
    count: int


def most_missed_weekday(
    habits: Sequence[HabitView], idx: LogIndex, first: date, today: date
) -> MostMissed | None:
    miss = [0] * 7
    for h in habits:
        for d in days_between(first, today):
            if cell_for(h, d, idx, today) == "missed":
                miss[js_weekday(d)] += 1
    top = max(miss)
    return MostMissed(day=WEEKDAY_SHORT[miss.index(top)], count=top) if top else None


def sorted_habits(habits: Iterable[HabitView]) -> list[HabitView]:
    return sorted(habits, key=lambda h: h.sort_order)


def auto_status(habit_type: str, target: float | None, value: float | None) -> str:
    """The status a log gets when none is given: check habits and target-less
    or value-less logs are done; otherwise done iff value reaches target."""
    if habit_type == "check" or not target or value is None:
        return "done"
    return "done" if value >= target else "partial"


def fmt_minutes(m: float) -> str:
    """``fmtMinutes``: ``45m``, ``1h``, ``10h 27m``."""
    if m >= 60:
        rest = m % 60
        return f"{math.floor(m / 60)}h" + (f" {_num(rest)}m" if rest else "")
    return f"{_num(m)}m"


def _num(v: float) -> str:
    return str(int(v)) if float(v).is_integer() else str(v)
