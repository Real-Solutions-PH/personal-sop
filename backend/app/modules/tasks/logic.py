"""Pure task logic, ported from ``shared/prototype/tasks/logic.ts`` and the
Today/stats hooks. No database: every function takes plain views so the
golden fixtures (``tests/golden/tasks-*.json``) can drive it directly.

Business days come from a :class:`~app.shared.day.DayClock` (the prototype's
``dayKey`` is the same rule: the user's zone, rolled at the day-start hour).
Weekdays use the JS convention, 0 = Sunday.
"""

from collections.abc import Callable, Iterable, Mapping, Sequence
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from decimal import ROUND_HALF_UP, Decimal
from functools import cmp_to_key
from math import floor
from typing import Any

from app.modules.stats.contract import CalendarItem, Metric, Miss
from app.shared.day import DayClock, js_weekday

WEEKDAYS = ("Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat")
MONTHS = (
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
)
# ``nextDue`` scans at most this many days for the next matching date.
SCAN_DAYS = 400

Recurrence = Mapping[str, Any]


# ---------------------------------------------------------------- JS numerics


def js_round(x: float) -> int:
    """``Math.round``: halves round toward +infinity (Python rounds to even)."""
    return floor(x + 0.5)


def js_to_fixed(x: float, digits: int = 1) -> str:
    """``Number.prototype.toFixed``: rounds the exact binary value half-up."""
    q = Decimal(1).scaleb(-digits)
    return str(Decimal(x).quantize(q, rounding=ROUND_HALF_UP))


# ---------------------------------------------------------------- views


@dataclass(frozen=True)
class ListView:
    id: str
    name: str
    kind: str = "standard"
    sort_order: int = 0
    archived: bool = False


@dataclass(frozen=True)
class TaskView:
    id: str
    title: str
    list_id: str | None
    status: str
    created_at: datetime
    due_date: date | None = None
    due_time: str | None = None
    remind_at: datetime | None = None
    recurrence: Recurrence | None = None
    starred: bool = False
    completed_at: datetime | None = None
    deleted_at: datetime | None = None
    source: str = "manual"
    original_due: date | None = None
    reschedule_count: int = 0
    order: int = 0
    notes: str | None = None


@dataclass(frozen=True)
class EventView:
    type: str
    at: datetime


@dataclass(frozen=True)
class TasksState:
    lists: Sequence[ListView]
    tasks: Sequence[TaskView]
    events: Sequence[EventView] = field(default_factory=tuple)
    count_groceries: bool = True


# ---------------------------------------------------------------- dates


def add_days(day: date, n: int) -> date:
    return day + timedelta(days=n)


def diff_days(a: date, b: date) -> int:
    return (b - a).days


def fmt_repeat(r: Recurrence | None) -> str | None:
    if not r:
        return None
    rule = r["rule"]
    kind = rule["kind"]
    if kind == "daily":
        base = "Daily"
    elif kind == "weekdays":
        base = "Weekdays"
    elif kind == "weekly":
        base = "Weekly · " + ", ".join(WEEKDAYS[d] for d in rule["days"])
    elif kind == "monthly":
        base = f"Monthly · day {rule['day']}"
    else:
        base = f"Every {rule['n']} days"
    return f"{base} after done" if r["mode"] == "after" else base


def _matches(rule: Mapping[str, Any], day: date, anchor: date) -> bool:
    kind = rule["kind"]
    wd = js_weekday(day)
    if kind == "daily":
        return True
    if kind == "weekdays":
        return 0 < wd < 6
    if kind == "weekly":
        return wd in rule["days"]
    if kind == "monthly":
        return bool(day.day == rule["day"])
    if kind == "everyN":
        return diff_days(anchor, day) % int(rule["n"]) == 0
    raise ValueError("unknown repeat rule")


def next_due(r: Recurrence, due: date, done_day: date) -> date:
    """The next occurrence's due date.

    ``after`` mode steps from the completion day (monthly = 30 days, weekly =
    7); ``fixed`` mode takes the first rule match after the later of the due
    day and the completion day, so a late completion never piles up missed
    occurrences.
    """
    rule = r["rule"]
    if r["mode"] == "after":
        kind = rule["kind"]
        step = (
            int(rule["n"])
            if kind == "everyN"
            else 30
            if kind == "monthly"
            else 7
            if kind == "weekly"
            else 1
        )
        return add_days(done_day, step)
    k = add_days(max(due, done_day), 1)
    for _ in range(SCAN_DAYS):
        if _matches(rule, k, due):
            return k
        k = add_days(k, 1)
    return add_days(done_day, 1)


# ---------------------------------------------------------------- task facts


def shopping_ids(lists: Iterable[ListView]) -> set[str]:
    return {lst.id for lst in lists if lst.kind == "shopping"}


def is_shopping(lists: Iterable[ListView], list_id: str | None) -> bool:
    return bool(list_id) and list_id in shopping_ids(lists)


def done_day(t: TaskView, clock: DayClock) -> date | None:
    return clock.day_of(t.completed_at) if t.completed_at else None


def is_overdue(t: TaskView, today: date) -> bool:
    return t.status == "open" and t.due_date is not None and t.due_date < today


def is_due_now(t: TaskView, now: datetime, clock: DayClock) -> bool:
    if t.status != "open" or t.due_date is None or not t.due_time:
        return False
    if t.due_date != clock.day_of(now):
        return False
    return clock.local_time(t.due_date, t.due_time) <= now


def _by_due_cmp(a: TaskView, b: TaskView) -> int:
    ad = a.due_date.isoformat() if a.due_date else "9"
    bd = b.due_date.isoformat() if b.due_date else "9"
    if ad != bd:
        return -1 if ad < bd else 1
    if a.starred != b.starred:
        return -1 if a.starred else 1
    at, bt = a.due_time or "99", b.due_time or "99"
    if at != bt:
        return -1 if at < bt else 1
    return a.order - b.order


by_due_key = cmp_to_key(_by_due_cmp)


def sort_by_due(tasks: Iterable[TaskView]) -> list[TaskView]:
    return sorted(tasks, key=by_due_key)


def list_name(lists: Iterable[ListView], list_id: str | None) -> str:
    if not list_id:
        return "Inbox"
    for lst in lists:
        if lst.id == list_id:
            return lst.name
    return "Inbox"


# ---------------------------------------------------------------- stats


@dataclass(frozen=True)
class DayCount:
    day: date
    done: int


@dataclass(frozen=True)
class ListCount:
    id: str | None
    name: str
    done: int


@dataclass(frozen=True)
class TaskStats:
    first: date
    last: date
    done: int
    on_time: int
    late: int
    with_due: int
    on_time_rate: float | None
    streak: int
    best_streak: int
    clear_days: int
    due_days: int
    overdue_now: int
    reschedules: int
    avg_reschedules: float
    avg_lateness: float | None
    follow_through: float
    capture_share: float | None
    created: int
    per_day: list[DayCount]
    by_list: list[ListCount]
    top_pushed: list[TaskView]


def compute_stats(
    s: TasksState, first: date, last: date, today: date, clock: DayClock
) -> TaskStats:
    shop_ids = shopping_ids(s.lists)

    def shop(t: TaskView) -> bool:
        return bool(t.list_id) and t.list_id in shop_ids

    def in_range(k: date | None) -> bool:
        return k is not None and first <= k <= last

    dday = {t.id: done_day(t, clock) for t in s.tasks}
    done = [
        t
        for t in s.tasks
        if t.status == "done"
        and in_range(dday[t.id])
        and (s.count_groceries or not shop(t))
    ]
    with_due_done = [t for t in done if t.due_date and not shop(t)]
    on_time = [
        t for t in with_due_done if (dday[t.id] or date.min) <= (t.due_date or date.min)
    ]
    late = len(with_due_done) - len(on_time)

    days = {dday[t.id] for t in s.tasks if t.status == "done"}
    streak = 0
    k = today if today in days else add_days(today, -1)
    while k in days:
        streak += 1
        k = add_days(k, -1)
    best = 0
    run = 0
    ordered = sorted(d for d in days if d is not None)
    for i, d in enumerate(ordered):
        run = run + 1 if i and diff_days(ordered[i - 1], d) == 1 else 1
        best = max(best, run)

    clear_days = 0
    due_days = 0
    d = first
    while d <= last and d <= today:
        due = [
            t
            for t in s.tasks
            if t.status != "deleted" and t.due_date == d and not shop(t)
        ]
        if due:
            clear = all(
                t.status == "done" and (dday[t.id] or date.min) <= d for t in due
            )
            if not (d == today and not clear):
                due_days += 1
                if clear:
                    clear_days += 1
        d = add_days(d, 1)

    overdue_now = sum(1 for t in s.tasks if is_overdue(t, today) and not shop(t))
    resched = sum(
        1 for e in s.events if e.type == "rescheduled" and in_range(clock.day_of(e.at))
    )
    lateness: list[int] = []
    for t in done:
        dd = dday[t.id]
        if t.original_due and not shop(t) and dd is not None and dd > t.original_due:
            lateness.append(diff_days(t.original_due, dd))
    created = [t for t in s.tasks if in_range(clock.day_of(t.created_at))]

    per_day: list[DayCount] = []
    d = first
    while d <= last:
        per_day.append(DayCount(day=d, done=sum(1 for t in done if dday[t.id] == d)))
        d = add_days(d, 1)

    list_ids: list[str | None] = [lst.id for lst in s.lists]
    list_ids.append(None)
    by_list = sorted(
        (
            x
            for x in (
                ListCount(
                    id=lid,
                    name=list_name(s.lists, lid),
                    done=sum(1 for t in done if t.list_id == lid),
                )
                for lid in list_ids
            )
            if x.done > 0
        ),
        key=lambda x: -x.done,
    )
    top_pushed = sorted(
        (t for t in s.tasks if t.status != "deleted" and t.reschedule_count > 0),
        key=lambda t: -t.reschedule_count,
    )[:3]

    return TaskStats(
        first=first,
        last=last,
        done=len(done),
        on_time=len(on_time),
        late=late,
        with_due=len(with_due_done),
        on_time_rate=len(on_time) / len(with_due_done) if with_due_done else None,
        streak=streak,
        best_streak=max(best, streak),
        clear_days=clear_days,
        due_days=due_days,
        overdue_now=overdue_now,
        reschedules=resched,
        avg_reschedules=(
            sum(t.reschedule_count for t in done) / len(done) if done else 0
        ),
        avg_lateness=sum(lateness) / len(lateness) if lateness else None,
        follow_through=(len(on_time) + 0.5 * late) / max(1, overdue_now + resched),
        capture_share=(
            sum(1 for t in created if t.source != "manual") / len(created)
            if created
            else None
        ),
        created=len(created),
        per_day=per_day,
        by_list=by_list,
        top_pushed=top_pushed,
    )


def stats_window(today: date, days: int, offset: int = 0) -> tuple[date, date]:
    """``useStats(days, offset)``: ``days`` ending ``offset`` days ago."""
    last = add_days(today, -offset)
    return add_days(last, -(days - 1)), last


# ---------------------------------------------------------------- today


@dataclass(frozen=True)
class UpcomingDay:
    day: date
    tasks: list[TaskView]


@dataclass(frozen=True)
class TodayData:
    overdue: list[TaskView]
    due: list[TaskView]
    done_today: list[TaskView]
    done_due_today: list[TaskView]
    upcoming: list[UpcomingDay]
    later: list[TaskView]
    inbox: list[TaskView]
    starred: list[TaskView]
    shopping_open: int
    next_reminder: TaskView | None
    ever_had_tasks: bool


def visible_tasks(s: TasksState) -> list[TaskView]:
    """Live tasks outside shopping lists and archived lists."""
    shop = shopping_ids(s.lists)
    archived = {lst.id for lst in s.lists if lst.archived}
    return [
        t
        for t in s.tasks
        if t.status != "deleted"
        and not (t.list_id and t.list_id in shop)
        and not (t.list_id and t.list_id in archived)
    ]


def today_data(s: TasksState, now: datetime, clock: DayClock) -> TodayData:
    tk = clock.day_of(now)
    shop = shopping_ids(s.lists)
    archived = {lst.id for lst in s.lists if lst.archived}
    vis = visible_tasks(s)
    open_ = [t for t in vis if t.status == "open"]
    done_today = [t for t in vis if t.status == "done" and done_day(t, clock) == tk]
    horizon = add_days(tk, 7)
    reminders = sorted(
        (t for t in open_ if t.remind_at and t.remind_at > now),
        key=lambda t: t.remind_at or now,
    )

    def pick(pred: Callable[[TaskView], bool]) -> list[TaskView]:
        return sort_by_due(t for t in open_ if pred(t))

    return TodayData(
        overdue=pick(lambda t: is_overdue(t, tk)),
        due=pick(lambda t: t.due_date == tk),
        done_today=done_today,
        done_due_today=[t for t in done_today if t.due_date and t.due_date <= tk],
        upcoming=[
            UpcomingDay(
                day=day, tasks=sort_by_due(t for t in open_ if t.due_date == day)
            )
            for day in (add_days(tk, i + 1) for i in range(7))
        ],
        later=pick(lambda t: t.due_date is not None and t.due_date > horizon),
        inbox=pick(lambda t: t.list_id is None),
        starred=pick(lambda t: t.starred),
        shopping_open=sum(
            1
            for t in s.tasks
            if t.status == "open"
            and t.list_id
            and t.list_id in shop
            and t.list_id not in archived
        ),
        next_reminder=reminders[0] if reminders else None,
        ever_had_tasks=len(s.tasks) > 0,
    )


@dataclass(frozen=True)
class Progress:
    due: int
    done: int


def today_progress(s: TasksState, now: datetime, clock: DayClock) -> Progress:
    d = today_data(s, now, clock)
    return Progress(
        due=len(d.due) + len(d.overdue) + len(d.done_due_today),
        done=len(d.done_due_today),
    )


def day_progress(s: TasksState, day: date, clock: DayClock) -> Progress:
    """Due/done on any business day, from the current state.

    For ``day`` = today this equals :func:`today_progress`: open tasks due on
    or before the day, plus tasks completed that day with a due on or before
    it. For a past day, a task completed before that day was already off the
    board, so it is excluded; one completed on or after the day still counted
    as due then.
    """
    due = 0
    done = 0
    for t in visible_tasks(s):
        if t.due_date is None or t.due_date > day:
            continue
        if clock.day_of(t.created_at) > day:
            continue
        dd = done_day(t, clock)
        if t.status == "done":
            if dd is None or dd < day:
                continue
            due += 1
            if dd == day:
                done += 1
        else:
            due += 1
    return Progress(due=due, done=done)


# ---------------------------------------------------------------- contract
# Ported from ``shared/prototype/tasks/index.ts`` (the module contract).


def area_rate(stats: TaskStats) -> float:
    return 0.5 if stats.on_time_rate is None else stats.on_time_rate


def _pp(v: float | None) -> int:
    return 0 if v is None else js_round(v * 100)


def _round1(n: float) -> float:
    return js_round(n * 10) / 10


def metrics(cur: TaskStats, prev: TaskStats) -> list[Metric]:
    return [
        Metric(
            key="tasks.done",
            label="Tasks done",
            value=str(cur.done),
            number=cur.done,
            delta=cur.done - prev.done,
            good_when="up",
            shareable=True,
        ),
        Metric(
            key="tasks.onTime",
            label="On-time rate",
            value="—" if cur.on_time_rate is None else f"{_pp(cur.on_time_rate)}%",
            number=cur.on_time_rate,
            delta=_pp(cur.on_time_rate) - _pp(prev.on_time_rate),
            good_when="up",
            shareable=True,
        ),
        Metric(
            key="tasks.streak",
            label="Done streak",
            value=f"{cur.streak}-day",
            number=cur.streak,
            good_when="up",
            shareable=True,
        ),
        Metric(
            key="tasks.overdue",
            label="Overdue now",
            value=str(cur.overdue_now),
            number=cur.overdue_now,
            good_when="down",
            shareable=False,
        ),
        Metric(
            key="tasks.reschedules",
            label="Reschedules",
            value=str(cur.reschedules),
            number=cur.reschedules,
            delta=cur.reschedules - prev.reschedules,
            good_when="down",
            shareable=False,
        ),
        Metric(
            key="tasks.followThrough",
            label="Follow-through ratio",
            value=js_to_fixed(cur.follow_through, 1),
            number=cur.follow_through,
            delta=_round1(cur.follow_through - prev.follow_through),
            good_when="up",
            shareable=True,
        ),
    ]


def _href(t: TaskView) -> str:
    return f"/tasks/task/{t.id}"


def calendar(s: TasksState, first: date, last: date) -> list[CalendarItem]:
    shop = shopping_ids(s.lists)
    return [
        CalendarItem(
            id=f"task:{t.id}",
            day=t.due_date,
            time=t.due_time or None,
            title=t.title,
            module="tasks",
            done=t.status == "done",
            href=_href(t),
        )
        for t in s.tasks
        if t.status != "deleted"
        and t.due_date is not None
        and first <= t.due_date <= last
        and not (t.list_id and t.list_id in shop)
    ]


def misses(
    s: TasksState, first: date, last: date, today: date, clock: DayClock
) -> list[Miss]:
    shop = shopping_ids(s.lists)
    out: list[Miss] = []
    for t in s.tasks:
        if t.status == "deleted" or t.due_date is None:
            continue
        if t.list_id and t.list_id in shop:
            continue
        if t.status == "open" and t.due_date < today and first <= t.due_date <= last:
            out.append(
                Miss(
                    id=f"task-overdue:{t.id}",
                    day=t.due_date,
                    title=f"Overdue {diff_days(t.due_date, today)}d: {t.title}",
                    module="tasks",
                    href=_href(t),
                    kind="overdue",
                )
            )
        dd = done_day(t, clock)
        if (
            t.status == "done"
            and dd is not None
            and t.original_due is not None
            and dd > t.original_due
            and first <= dd <= last
        ):
            out.append(
                Miss(
                    id=f"task-late:{t.id}",
                    day=dd,
                    title=f"Done {diff_days(t.original_due, dd)}d late: {t.title}",
                    module="tasks",
                    href=_href(t),
                    kind="late",
                )
            )
        if (
            t.status == "open"
            and t.reschedule_count >= 3
            and first <= t.due_date <= add_days(last, 30)
        ):
            out.append(
                Miss(
                    id=f"task-pushed:{t.id}",
                    day=t.due_date,
                    title=f"Pushed {t.reschedule_count}×: {t.title}",
                    module="tasks",
                    href=_href(t),
                    kind="pushed",
                )
            )
    return sorted(out, key=lambda m: m.day, reverse=True)
