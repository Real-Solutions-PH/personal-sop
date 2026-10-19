"""Pure aggregation rules of the one aggregate statistic (ADR-0014).

A port of ``shared/prototype/dash/hooks.ts`` and ``dash/facets.ts``: the Life
Score, levels, the on-target day series and streaks, the metric book, goal
progress, achievements and facets. No database access: the services feed
these with what the module contributors computed, and the golden tests feed
them with what the prototype computed (``scripts/golden/stats.golden.test.ts``).

Rounding follows JavaScript (``Math.round`` rounds half toward +inf), never
Python's banker's rounding.
"""

import math
import re
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass, field
from datetime import date, timedelta
from typing import Literal

from app.modules.stats.contract import Metric

MODULE_KEYS: tuple[str, ...] = ("habits", "tasks", "fitness", "finance")
STREAK_MILESTONES: tuple[int, ...] = (7, 30, 100, 365)
# The on-target series always spans at least a year so the all-time streaks
# (``useOnTarget``) see the same history whatever range the screen shows.
MIN_SERIES_DAYS = 365

LEVELS: tuple[tuple[str, int], ...] = (
    ("Getting started", 0),
    ("Building", 40),
    ("Steady", 55),
    ("Strong", 65),
    ("Excellent", 75),
    ("Peak", 85),
)
NOT_SCORED = "Not scored yet"


def js_round(x: float) -> int:
    """``Math.round``: half rounds toward +infinity."""
    return math.floor(x + 0.5)


def js_num(x: float) -> str:
    """A number as JavaScript's template literal renders it (``4`` not
    ``4.0``)."""
    if isinstance(x, bool):
        return "true" if x else "false"
    if float(x).is_integer():
        return str(int(x))
    return repr(float(x))


def clamp01(v: float) -> float:
    return max(0.0, min(1.0, v))


# ---------------------------------------------------------------- life score


def life_score_of(
    rates: Mapping[str, float | None],
    weights: Mapping[str, int],
    enabled: Mapping[str, bool],
) -> int | None:
    """``round(Σ wₖ·clamp(rateₖ) / Σ wₖ · 100)`` over enabled areas with a
    weight above zero. An area whose contributor has nothing to rate
    (``None``) is left out of both sums rather than counted as zero."""
    num = 0.0
    den = 0
    for k in MODULE_KEYS:
        rate = rates.get(k)
        if not enabled.get(k, False) or weights.get(k, 0) <= 0 or rate is None:
            continue
        num += weights[k] * clamp01(rate)
        den += weights[k]
    return js_round(num / den * 100) if den else None


@dataclass(frozen=True)
class Level:
    name: str
    floor: int
    next_name: str | None
    next_floor: int | None


def level_for(score: int | None) -> Level:
    if score is None:
        return Level(NOT_SCORED, 0, None, None)
    i = 0
    while i + 1 < len(LEVELS) and score >= LEVELS[i + 1][1]:
        i += 1
    nxt = LEVELS[i + 1] if i + 1 < len(LEVELS) else None
    return Level(
        LEVELS[i][0],
        LEVELS[i][1],
        nxt[0] if nxt else None,
        nxt[1] if nxt else None,
    )


# ---------------------------------------------------------------- on target


@dataclass(frozen=True)
class DayResult:
    day: date
    due: int
    done: int
    on_target: bool | None


@dataclass(frozen=True)
class SeriesItem:
    """One calendar item reduced to what the on-target series reads."""

    day: date
    module: str
    done: bool


def series_length(days: int) -> int:
    return max(days * 2, MIN_SERIES_DAYS)


def day_series(
    items: Iterable[SeriesItem],
    *,
    today: date,
    length: int,
    enabled: Mapping[str, bool],
    threshold: float,
    sealed: Iterable[date] = (),
) -> list[DayResult]:
    """``useDaySeries``: each day's habit and task calendar items (enabled
    modules only), on target when ``done / due >= threshold``. Today is only
    judged early when it is already on target; a sealed (wrapped-up) today
    that is short counts as off target, an open one is not scored yet."""
    counts: dict[date, list[int]] = {}
    for i in items:
        if i.module not in ("habits", "tasks") or not enabled.get(i.module, False):
            continue
        c = counts.setdefault(i.day, [0, 0])
        c[0] += 1
        if i.done:
            c[1] += 1
    sealed_days = set(sealed)
    out: list[DayResult] = []
    for back in range(length - 1, -1, -1):
        day = today - timedelta(days=back)
        due, done = counts.get(day, (0, 0))
        on_target: bool | None = None
        if due > 0:
            hit = done / due >= threshold
            if back == 0:
                on_target = True if hit else (False if day in sealed_days else None)
            else:
                on_target = hit
        out.append(DayResult(day, due, done, on_target))
    return out


@dataclass(frozen=True)
class OnTargetStats:
    rate: float | None
    on_target: int
    scored: int
    current: int
    best: int


def on_target_stats(series: Sequence[DayResult]) -> OnTargetStats:
    scored = [d for d in series if d.on_target is not None]
    hits = sum(1 for d in scored if d.on_target)
    current = 0
    for d in reversed(series):
        if d.on_target is None:
            continue
        if not d.on_target:
            break
        current += 1
    best = run = 0
    for d in series:
        if d.on_target is None:
            continue
        run = run + 1 if d.on_target else 0
        best = max(best, run)
    return OnTargetStats(
        rate=hits / len(scored) if scored else None,
        on_target=hits,
        scored=len(scored),
        current=current,
        best=best,
    )


@dataclass(frozen=True)
class OnTarget:
    """``useOnTarget(days)``: the range and the previous range of equal
    length; ``current``/``best`` streaks and ``logged`` are all-time (over
    the whole series)."""

    range: list[DayResult]
    rate: float | None
    prev_rate: float | None
    on_target: int
    scored: int
    current: int
    best: int
    logged: int


def on_target(series: Sequence[DayResult], days: int) -> OnTarget:
    cur = list(series[-days:]) if days else []
    prev = list(series[-days * 2 : -days]) if days else []
    every = on_target_stats(series)
    c = on_target_stats(cur)
    p = on_target_stats(prev)
    return OnTarget(
        range=cur,
        rate=c.rate,
        prev_rate=p.rate,
        on_target=c.on_target,
        scored=c.scored,
        current=every.current,
        best=every.best,
        logged=sum(1 for d in series if d.done > 0),
    )


# ---------------------------------------------------------------- metrics

_FRACTION = re.compile(r"\d\s*/\s*\d", re.ASCII)
_DURATION = re.compile(r"\d+h|\d+m\b", re.ASCII)
_NUMBER = re.compile(r"-?\d+(\.\d+)?", re.ASCII)


def parse_metric(value: str) -> float | None:
    """``parseMetric``: the first number in a formatted metric value; a
    fraction ("3 / 4") or a duration ("1h 20m") has no single number."""
    if _FRACTION.search(value) or _DURATION.search(value):
        return None
    m = _NUMBER.search(value.replace(",", ""))
    return float(m.group(0)) if m else None


def unit_of(value: str) -> str:
    return "%" if "%" in value else " kg" if "kg" in value else ""


@dataclass(frozen=True)
class BookEntry:
    ref: str
    label: str
    module: str
    value: str
    n: float | None
    unit: str
    good_when: Literal["up", "down"]
    shareable: bool
    delta: float | None = None


def metric_book(
    metrics: Mapping[str, Sequence[Metric]],
    life: int | None,
    target_rate: float | None,
    enabled: Mapping[str, bool],
) -> dict[str, BookEntry]:
    """Every goal-able metric of one period by ref: ``life``, ``onTarget``
    and ``<module>:<key>`` for each enabled module's metrics."""
    out: dict[str, BookEntry] = {
        "life": BookEntry(
            ref="life",
            label="Life Score",
            module="life",
            value="—" if life is None else str(life),
            n=None if life is None else float(life),
            unit="",
            good_when="up",
            shareable=True,
        ),
        "onTarget": BookEntry(
            ref="onTarget",
            label="On-target rate",
            module="life",
            value="—" if target_rate is None else f"{js_round(target_rate * 100)}%",
            n=None if target_rate is None else float(js_round(target_rate * 100)),
            unit="%",
            good_when="up",
            shareable=True,
        ),
    }
    for k in MODULE_KEYS:
        if not enabled.get(k, False):
            continue
        for m in metrics.get(k, ()):
            ref = f"{k}:{m.key}"
            out[ref] = BookEntry(
                ref=ref,
                label=m.label,
                module=k,
                value=m.value,
                n=parse_metric(m.value),
                unit=unit_of(m.value),
                good_when=m.good_when or "up",
                shareable=m.shareable,
                delta=m.delta,
            )
    return out


# ---------------------------------------------------------------- goals


@dataclass(frozen=True)
class GoalSpec:
    id: str
    metric: str
    label: str
    target: float
    unit: str
    comparator: Literal["gte", "lte"]
    period: Literal["week", "month"]
    created: date
    status: Literal["active", "archived"]


@dataclass(frozen=True)
class Progress:
    pct: float
    hit: bool
    current: float | None


def goal_progress(
    comparator: str, target: float, current: float | None
) -> Progress:
    if current is None:
        return Progress(0.0, False, None)
    if comparator == "gte":
        return Progress(
            current / target if target else 1.0, current >= target, current
        )
    return Progress(
        1.0 if current <= target else target / max(current, 0.0001),
        current <= target,
        current,
    )


FIXED_LABEL = {"life": "Life Score", "onTarget": "On-target rate"}


@dataclass(frozen=True)
class GoalView:
    goal: GoalSpec
    label: str
    entry: BookEntry | None
    progress: Progress


def goal_views(
    goals: Sequence[GoalSpec],
    week: Mapping[str, BookEntry],
    month: Mapping[str, BookEntry],
    metrics30: Mapping[str, Sequence[Metric]],
) -> list[GoalView]:
    """``useGoals``: each goal against its period's book. The label follows
    the metric's current label when the metric still exists."""
    out: list[GoalView] = []
    for g in goals:
        entry = (week if g.period == "week" else month).get(g.metric)
        mod, _, key = g.metric.partition(":")
        label = entry.label if entry else FIXED_LABEL.get(g.metric)
        if label is None and key:
            label = next((m.label for m in metrics30.get(mod, ()) if m.key == key), None)
        out.append(
            GoalView(
                goal=g,
                label=label or g.label,
                entry=entry,
                progress=goal_progress(
                    g.comparator, g.target, entry.n if entry else None
                ),
            )
        )
    return out


def fmt_goal(g: GoalSpec) -> str:
    sign = "≥" if g.comparator == "gte" else "≤"
    return f"{sign} {js_num(g.target)}{g.unit} / {g.period}"


# ---------------------------------------------------------------- achievements


@dataclass(frozen=True)
class Trophy:
    id: str
    type: str
    title: str
    value: str
    detail: str
    day: date
    href: str
    share_ref: str | None = None


@dataclass
class AchievementView:
    id: str
    type: str
    title: str
    requirement: str
    pct: float
    text: str
    trophy: Trophy | None = None


def _prog(cur: float, mx: float, unit: str) -> tuple[float, str]:
    pct = max(0.0, min(1.0, cur / mx)) if mx else 0.0
    return pct, f"{js_num(min(cur, mx))} / {js_num(mx)} {unit}"


def _find(metrics: Sequence[Metric], key: str) -> Metric | None:
    return next((m for m in metrics if m.key == key), None)


def achievements(
    *,
    series: Sequence[DayResult],
    current: int,
    m30: Mapping[str, Sequence[Metric]],
    m90: Mapping[str, Sequence[Metric]],
    goals: Sequence[GoalView],
    wrapup_days: Iterable[date],
    enabled: Mapping[str, bool],
    today: date,
) -> list[AchievementView]:
    """``useAchievements``: PR milestones, on-target and habit streak
    milestones, best/perfect windows, goals, hat trick and firsts."""
    out: list[AchievementView] = []
    yesterday = today - timedelta(days=1)

    if enabled.get("fitness", False):

        def prs(lst: Mapping[str, Sequence[Metric]]) -> float:
            m = _find(lst.get("fitness", ()), "prs")
            return parse_metric(m.value if m else "0") or 0.0

        p30, p90 = prs(m30), prs(m90)

        def pr(aid: str, title: str, req: str, cur: float, mx: int, detail: str) -> None:
            pct, text = _prog(cur, mx, "PR" if mx == 1 else "PRs")
            out.append(
                AchievementView(
                    aid, "pr", title, req, pct, text,
                    Trophy(aid, "pr", title, js_num(cur), detail, yesterday,
                           "/fitness/stats")
                    if cur >= mx else None,
                )
            )  # fmt: skip

        pr("pr-30", "PR this month",
           "Set a new best lift (est. 1-rep max) in the last 30 days", p30, 1,
           f"{js_num(p30)} new best lift{'' if p30 == 1 else 's'} in 30 days")  # fmt: skip
        pr("pr-90-5", "5 PRs in 90 days", "Set 5 new best lifts within 90 days",
           p90, 5, f"{js_num(p90)} new best lifts in 90 days")  # fmt: skip
        pr("pr-90-10", "10 PRs in 90 days", "Set 10 new best lifts within 90 days",
           p90, 10, f"{js_num(p90)} new best lifts in 90 days")  # fmt: skip

    hit_day: dict[int, date] = {}
    run = 0
    for d in series:
        if d.on_target is None:
            continue
        run = run + 1 if d.on_target else 0
        if run in STREAK_MILESTONES:
            hit_day[run] = d.day
    for n in STREAK_MILESTONES:
        day = hit_day.get(n)
        title = f"{n}-day on-target streak"
        pct, text = _prog(current, n, "days")
        out.append(
            AchievementView(
                f"streak-{n}", "streak", title,
                f"Hit your daily target {n} days in a row", pct, text,
                Trophy(f"streak-{n}-{day.isoformat()}", "streak", title, f"{n}d",
                       f"{n} on-target days in a row", day, "/stats", "streak")
                if day else None,
            )
        )  # fmt: skip

    if enabled.get("habits", False):
        hs = _find(m90.get("habits", ()), "habits.streak")
        top = parse_metric(hs.value if hs else "0") or 0.0
        who = re.sub(r"^Top streak( · )?", "", hs.label) if hs else ""
        for n in STREAK_MILESTONES:
            pct, text = _prog(top, n, "days")
            out.append(
                AchievementView(
                    f"habit-streak-{n}", "streak", f"{n}-day habit streak",
                    f"Reach a {n}-day streak on any habit", pct, text,
                    Trophy(f"habit-streak-{n}", "streak",
                           f"{n}-day streak · {who}" if who else f"{n}-day habit streak",
                           f"{n}d", f"Current top habit streak: {js_num(top)} days",
                           today - timedelta(days=int(top - n)), "/habits", "streak")
                    if top >= n else None,
                )
            )  # fmt: skip

    def best_window(n: int) -> tuple[int, date | None]:
        best, end = 0, None
        for i in range(n, len(series) + 1):
            w = series[i - n : i]
            hits = sum(1 for d in w if d.on_target)
            if hits > best:
                best, end = hits, w[-1].day
        return best, end

    bw, bm = best_window(7), best_window(30)

    def best(aid: str, title: str, req: str, w: tuple[int, date | None], n: int,
             mx: int, share: str) -> None:  # fmt: skip
        hits, end = w
        pct, text = _prog(hits, mx, "days")
        out.append(
            AchievementView(
                aid, "best", title, req, pct, text,
                Trophy(f"{aid}-{end.isoformat() if end else ''}", "best", title,
                       f"{hits}/{n}", f"{hits} on-target days in {n}",
                       end, "/stats", share)
                if hits >= mx and end is not None else None,
            )
        )  # fmt: skip

    best("best-week", "Best week", "Have an on-target day", bw, 7, 1, "weekly")
    best("best-month", "Best month", "Have an on-target day", bm, 30, 1, "monthly")
    best("perfect-week", "Perfect week",
         "Hit your daily target on all 7 days of a week", bw, 7, 7, "weekly")  # fmt: skip
    best("perfect-month", "Perfect month",
         "Hit your daily target on all 30 days of a month", bm, 30, 30, "monthly")  # fmt: skip

    active = [g for g in goals if g.goal.status == "active"]
    for g in active:
        spec = g.goal
        title = f"{g.label} {fmt_goal(spec)}"
        target = f"{js_num(spec.target)}{spec.unit}"
        out.append(
            AchievementView(
                f"goal-{spec.id}", "goal", title,
                f"Reach {'at least' if spec.comparator == 'gte' else 'at most'} "
                f"{target} this {spec.period}",
                max(0.0, min(1.0, g.progress.pct)),
                f"{g.entry.value if g.entry else '—'} / {target}",
                Trophy(f"goal-{spec.id}", "goal", title, g.entry.value,
                       f"Target {target}", today, "/stats/goals", "goal")
                if g.progress.hit and g.entry else None,
            )
        )  # fmt: skip
    hits = sum(1 for g in active if g.progress.hit)
    pct, text = _prog(hits, 3, "goals")
    out.append(
        AchievementView(
            "goal-hat-trick", "goal", "Hat trick", "Hit 3 goals at the same time",
            pct, text,
            Trophy("goal-hat-trick", "goal", "Hat trick", str(hits),
                   f"{hits} goals hit at once", today, "/stats/goals", "goal")
            if hits >= 3 else None,
        )
    )  # fmt: skip

    def first(aid: str, title: str, req: str, day: date | None, detail: str,
              href: str) -> None:  # fmt: skip
        pct, text = _prog(1 if day else 0, 1, "")
        out.append(
            AchievementView(
                aid, "first", title, req, pct, text,
                Trophy(f"{aid}-{day.isoformat()}", "first", title, "1st", detail,
                       day, href)
                if day else None,
            )
        )  # fmt: skip

    first("first-on-target", "First on-target day", "Hit your daily target once",
          next((d.day for d in series if d.on_target), None),
          "Where the streaks began", "/stats")  # fmt: skip
    first("first-wrap", "First day wrapped up", "Seal a day with an evening wrap-up",
          min(wrapup_days, default=None), "Sealed a day with a reflection",
          "/today/wrap-up")  # fmt: skip
    first("first-goal", "First goal set", "Set a goal on any metric",
          min((g.goal.created for g in goals), default=None), "Put a number on it",
          "/stats/goals")  # fmt: skip
    for a in out:
        a.text = a.text.strip()
    return out


def trophies(items: Sequence[AchievementView]) -> list[Trophy]:
    """Earned trophies, newest first (ties keep achievement order)."""
    earned = [a.trophy for a in items if a.trophy is not None]
    return sorted(earned, key=lambda t: t.day, reverse=True)


# ---------------------------------------------------------------- facets


@dataclass(frozen=True)
class FacetView:
    key: str
    label: str
    module: str
    value: float
    prev: float
    off: bool
    href: str
    # None = all of the module's metrics belong to the facet.
    metric_keys: tuple[str, ...] | None = None
    extra: list[Metric] = field(default_factory=list)


def compose_facets(
    *,
    rates: Mapping[str, float | None],
    prev_rates: Mapping[str, float | None],
    enabled: Mapping[str, bool],
    routines: tuple[float, float],
    training: tuple[float, float],
    nutrition: tuple[float, float],
    routine_extra: Sequence[Metric] = (),
) -> list[FacetView]:
    """``useFacets``: the six facets in screen order. Habits, tasks and
    finance are the area rates; routines, training and nutrition come from
    the habits and fitness contributors."""

    def r(m: Mapping[str, float | None], k: str) -> float:
        return m.get(k) or 0.0

    def f(key: str, label: str, module: str, value: float, prev: float, href: str,
          keys: tuple[str, ...] | None = None, extra: Sequence[Metric] = ()) -> FacetView:  # fmt: skip
        return FacetView(
            key, label, module, value, prev, not enabled.get(module, False), href,
            keys, list(extra),
        )  # fmt: skip

    return [
        f("habits", "Habits", "habits", r(rates, "habits"), r(prev_rates, "habits"),
          "/habits"),  # fmt: skip
        f("routines", "Routines", "habits", routines[0], routines[1],
          "/habits/routines", (), routine_extra),  # fmt: skip
        f("tasks", "Tasks", "tasks", r(rates, "tasks"), r(prev_rates, "tasks"),
          "/tasks/stats"),  # fmt: skip
        f("training", "Training", "fitness", training[0], training[1],
          "/fitness?tab=train", ("sessions", "prs", "volume", "overload")),  # fmt: skip
        f("nutrition", "Nutrition", "fitness", nutrition[0], nutrition[1],
          "/fitness?tab=eat", ("calories", "protein", "weight")),  # fmt: skip
        f("finance", "Finance", "finance", r(rates, "finance"),
          r(prev_rates, "finance"), "/finance/reports"),  # fmt: skip
    ]
