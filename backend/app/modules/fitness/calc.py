"""Pure fitness calculations: a port of ``shared/prototype/fitness/calc.ts``.

Every function takes a :class:`FitState` snapshot (plain dataclasses, no
database) plus the reference business day, so the same code serves the
routes, the stats contributor and the golden tests. The prototype computes
"today" from the device clock; here the caller passes ``today`` (from
``ctx.today``) and the day of an instant comes from ``state.clock``.

Rounding follows JavaScript: ``Math.round`` rounds half toward +inf and
``toFixed`` rounds the exact binary value half-up, neither of which is
Python's ``round``. See :func:`js_round` and :func:`to_fixed`.
"""

import math
from collections.abc import Iterable
from dataclasses import dataclass, field, replace
from datetime import date, datetime, timedelta
from decimal import ROUND_HALF_UP, Decimal
from typing import Literal

from app.shared.day import DayClock

PrKind = Literal["e1rm", "weight", "volume"]
PR_KINDS: tuple[PrKind, ...] = ("e1rm", "weight", "volume")
PR_LABEL: dict[str, str] = {
    "e1rm": "Est. 1-rep max",
    "weight": "Heaviest",
    "volume": "Volume",
}


# --------------------------------------------------------------------------
# Snapshot types
# --------------------------------------------------------------------------


@dataclass
class ExerciseS:
    id: str
    name: str
    equipment: str = "barbell"
    muscle: str = "chest"
    load_type: str = "weight"
    rep_min: int = 8
    rep_max: int = 12
    increment: float = 2.5
    archived: bool = False


@dataclass
class SetS:
    id: str
    reps: int
    weight: float
    kind: str = "working"
    completed_at: datetime | None = None


@dataclass
class WorkoutExerciseS:
    id: str
    exercise_id: str
    sets: list[SetS] = field(default_factory=list)
    note: str | None = None


@dataclass
class WorkoutS:
    id: str
    name: str
    started_at: datetime
    status: str = "finished"
    exercises: list[WorkoutExerciseS] = field(default_factory=list)
    template_id: str | None = None
    ended_at: datetime | None = None
    source: str = "live"
    notes: str | None = None


@dataclass
class TemplateItemS:
    exercise_id: str
    sets: int


@dataclass
class TemplateS:
    id: str
    name: str
    items: list[TemplateItemS] = field(default_factory=list)


@dataclass
class WeighInS:
    id: str
    measured_at: datetime
    weight_kg: float
    body_fat_pct: float | None = None
    note: str | None = None


@dataclass
class Macros:
    kcal: float = 0
    protein: float = 0
    carbs: float = 0
    fat: float = 0


@dataclass
class TargetS(Macros):
    id: str = ""
    effective_from: date = date.min
    sat_fat_max_g: float | None = None
    sugar_max_g: float | None = None
    sodium_max_mg: float | None = None
    fiber_g: float | None = None


@dataclass
class AdjustmentS:
    id: str
    day: date
    kcal: float


@dataclass
class MealItemS(Macros):
    id: str = ""
    name: str = ""
    qty: float = 1
    unit: str = ""
    assumption: str | None = None


@dataclass
class MealS:
    id: str
    eaten_at: datetime
    label: str = "snack"
    status: str = "confirmed"
    items: list[MealItemS] = field(default_factory=list)
    source: str = "manual"
    raw_input: str = ""
    confidence: float | None = None


@dataclass
class SettingsS:
    units: str = "kg"
    rest_sec: int = 120
    weekly_target: int = 4
    progression: str = "double"
    goal_direction: str = "maintain"
    goal_weight: float | None = None


@dataclass
class FitState:
    exercises: list[ExerciseS] = field(default_factory=list)
    templates: list[TemplateS] = field(default_factory=list)
    workouts: list[WorkoutS] = field(default_factory=list)
    weigh_ins: list[WeighInS] = field(default_factory=list)
    targets: list[TargetS] = field(default_factory=list)
    adjustments: list[AdjustmentS] = field(default_factory=list)
    meals: list[MealS] = field(default_factory=list)
    settings: SettingsS = field(default_factory=SettingsS)
    clock: DayClock = field(default_factory=DayClock)

    def day(self, at: datetime) -> date:
        return self.clock.day_of(at)


# --------------------------------------------------------------------------
# JavaScript-compatible number formatting
# --------------------------------------------------------------------------


def js_round(n: float) -> int:
    """``Math.round``: half rounds toward +infinity."""
    return math.floor(n + 0.5)


def to_fixed(n: float, digits: int) -> str:
    """``Number.prototype.toFixed`` (half-up on the exact binary value)."""
    q = Decimal(1).scaleb(-digits)
    return str(Decimal(n).quantize(q, rounding=ROUND_HALF_UP))


def _is_int(n: float) -> bool:
    return float(n).is_integer()


def kg_short(n: float) -> str:
    return str(int(n)) if _is_int(n) else to_fixed(n, 1)


def kg(n: float) -> str:
    return f"{kg_short(n)} kg"


def fmt_volume(n: float) -> str:
    if n >= 10000:
        return f"{to_fixed(n / 1000, 1)}t"
    return f"{js_round(n):,} kg"


def fmt_min(sec: float) -> str:
    m = js_round(sec / 60)
    return f"{m // 60}h {m % 60}m" if m >= 60 else f"{m} min"


# --------------------------------------------------------------------------
# Sets, exercises, workouts
# --------------------------------------------------------------------------


def is_done(s: SetS) -> bool:
    return s.completed_at is not None


def is_working(s: SetS) -> bool:
    return s.kind != "warmup"


def e1rm(load: float, reps: int) -> float:
    """Epley estimated one-rep max, for 1..12 reps of a positive load."""
    if reps <= 0 or reps > 12 or load <= 0:
        return 0
    return load if reps == 1 else load * (1 + reps / 30)


def latest_bodyweight(s: FitState) -> float | None:
    best: WeighInS | None = None
    for w in s.weigh_ins:
        if best is None or w.measured_at > best.measured_at:
            best = w
    return best.weight_kg if best else None


def ex_map(s: FitState) -> dict[str, ExerciseS]:
    return {e.id: e for e in s.exercises}


def set_load(ex: ExerciseS | None, st: SetS, bw: float = 0) -> float:
    """Bodyweight exercises lift the lifter plus the added weight."""
    if ex is not None and ex.load_type == "bodyweight":
        return bw + st.weight
    return st.weight


@dataclass
class ExStats:
    best_e1rm: float
    heaviest: float
    volume: float
    top: SetS | None
    done_sets: int


def ex_stats(we: WorkoutExerciseS, ex: ExerciseS | None, bw: float = 0) -> ExStats:
    best = 0.0
    heaviest = 0.0
    volume = 0.0
    done = 0
    top: SetS | None = None
    for st in we.sets:
        if not is_done(st) or not is_working(st):
            continue
        done += 1
        load = set_load(ex, st, bw)
        volume += load * st.reps
        e = e1rm(load, st.reps)
        if e > best:
            best = e
            top = st
        if st.weight > heaviest:
            heaviest = st.weight
    if not best:
        # Nothing in the 1..12 rep band: rate the high-rep sets anyway.
        for st in we.sets:
            if not is_done(st) or not is_working(st):
                continue
            load = set_load(ex, st, bw)
            e = load * (1 + st.reps / 30)
            if e > best:
                best = e
                top = st
    if top is None:
        top = next((x for x in we.sets if is_done(x) and is_working(x)), None)
    return ExStats(best, heaviest, volume, top, done)


@dataclass
class Totals:
    volume: float
    done: int
    planned: int
    duration_sec: float


def workout_totals(s: FitState, w: WorkoutS, now: datetime) -> Totals:
    m = ex_map(s)
    bw = latest_bodyweight(s) or 0
    volume = 0.0
    done = 0
    planned = 0
    for we in w.exercises:
        st = ex_stats(we, m.get(we.exercise_id), bw)
        volume += st.volume
        done += st.done_sets
        planned += sum(1 for x in we.sets if is_working(x))
    end = w.ended_at or now
    return Totals(volume, done, planned, max(0.0, (end - w.started_at).total_seconds()))


def finished(s: FitState) -> list[WorkoutS]:
    return sorted(
        (w for w in s.workouts if w.status == "finished"), key=lambda w: w.started_at
    )


@dataclass
class HistPoint:
    workout: WorkoutS
    we: WorkoutExerciseS
    stats: ExStats


def exercise_history(s: FitState, exercise_id: str) -> list[HistPoint]:
    ex = next((e for e in s.exercises if e.id == exercise_id), None)
    bw = latest_bodyweight(s) or 0
    out: list[HistPoint] = []
    for w in finished(s):
        for we in w.exercises:
            if we.exercise_id == exercise_id:
                stats = ex_stats(we, ex, bw)
                if stats.done_sets:
                    out.append(HistPoint(w, we, stats))
    return out


@dataclass(frozen=True)
class Pr:
    workout_id: str
    exercise_id: str
    kind: PrKind
    value: float
    prev: float
    at: datetime


def all_prs(s: FitState, extra: WorkoutS | None = None) -> list[Pr]:
    """One PR per (workout, exercise): the first kind (e1RM, weight, volume)
    that beat the running best. The first session of a lift sets the bar and
    is never a PR; heaviest-weight PRs only count for weighted lifts."""
    m = ex_map(s)
    bw = latest_bodyweight(s) or 0
    best: dict[str, dict[str, float]] = {}
    out: list[Pr] = []
    workouts = finished(s)
    if extra is not None and extra.status != "finished":
        workouts.append(extra)
    for w in workouts:
        for we in w.exercises:
            ex = m.get(we.exercise_id)
            st = ex_stats(we, ex, bw)
            if not st.done_sets:
                continue
            cur = {"e1rm": st.best_e1rm, "weight": st.heaviest, "volume": st.volume}
            prev = best.get(we.exercise_id)
            if prev is None:
                best[we.exercise_id] = cur
                continue
            pushed = False
            for k in PR_KINDS:
                if cur[k] > prev[k] + 0.01 and (
                    k != "weight" or (ex is not None and ex.load_type == "weight")
                ):
                    if not pushed:
                        out.append(
                            Pr(w.id, we.exercise_id, k, cur[k], prev[k], w.started_at)
                        )
                    pushed = True
                    prev[k] = cur[k]
    return out


def prs_by_workout(prs: Iterable[Pr]) -> dict[str, list[Pr]]:
    out: dict[str, list[Pr]] = {}
    for p in prs:
        out.setdefault(p.workout_id, []).append(p)
    return out


@dataclass
class Suggestion:
    kind: Literal["weight", "reps", "new", "hold"]
    weight: float
    reps: int
    badge: str
    detail: str
    last_weight: float | None = None
    last_reps: list[int] | None = None


def suggestion(s: FitState, exercise_id: str) -> Suggestion:
    """Progressive overload: double progression by default (all sets at the
    rep-range max -> add the increment, else +1 rep), or linear (always add
    the increment). Reps- and time-based lifts aim one more than last time."""
    ex = next((e for e in s.exercises if e.id == exercise_id), None)
    hist = exercise_history(s, exercise_id)
    if ex is None or not hist:
        rep_min = ex.rep_min if ex else 8
        rep_max = ex.rep_max if ex else 12
        return Suggestion(
            "new",
            0,
            rep_min,
            "New",
            f"First time — pick a weight you can do for {rep_min}–{rep_max} reps.",
        )
    last = hist[-1]
    work = [x for x in last.we.sets if is_done(x) and is_working(x)]
    weight = max(x.weight for x in work)
    reps = [x.reps for x in work]
    if ex.load_type in ("time", "reps"):
        return Suggestion(
            "reps",
            weight,
            min(reps) + 1,
            "+1 rep",
            "Beat last time by one.",
            weight,
            reps,
        )
    if s.settings.progression == "linear" or all(r >= ex.rep_max for r in reps):
        nxt = weight + ex.increment
        detail = (
            f"Linear: add {kg_short(ex.increment)} kg each session."
            if s.settings.progression == "linear"
            else f"All sets hit {ex.rep_max} last time — go {kg(nxt)} × {ex.rep_min}."
        )
        return Suggestion(
            "weight",
            nxt,
            ex.rep_min,
            f"+{kg_short(ex.increment)} kg",
            detail,
            weight,
            reps,
        )
    target = min(ex.rep_max, min(reps) + 1)
    return Suggestion(
        "reps",
        weight,
        target,
        "+1 rep",
        f"Stay at {kg(weight)}; aim {target}+ reps on every set. "
        f"Move up at {ex.rep_max}×{len(work)}.",
        weight,
        reps,
    )


def is_stalled(s: FitState, hist: list[HistPoint], today: date) -> bool:
    """No e1RM gain in the last 3 weeks over the sessions before them (at
    least two sessions on each side)."""
    cutoff = today - timedelta(days=21)
    recent = [h for h in hist if s.day(h.workout.started_at) >= cutoff]
    before = [h for h in hist if s.day(h.workout.started_at) < cutoff]
    if len(recent) < 2 or len(before) < 2:
        return False
    best_before = max(h.stats.best_e1rm for h in before)
    best_recent = max(h.stats.best_e1rm for h in recent)
    return best_recent <= best_before + 0.01


def week_start(day: date) -> date:
    """Monday of ``day``'s week (the prototype's training week)."""
    return day - timedelta(days=day.weekday())


@dataclass
class WeekCount:
    start: date
    count: int


def sessions_by_week(s: FitState, weeks: int, today: date) -> list[WeekCount]:
    this_week = week_start(today)
    out = [
        WeekCount(this_week - timedelta(days=7 * i), 0)
        for i in range(weeks - 1, -1, -1)
    ]
    slots = {w.start: w for w in out}
    for w in finished(s):
        slot = slots.get(week_start(s.day(w.started_at)))
        if slot is not None:
            slot.count += 1
    return out


def consistency_streak(s: FitState, today: date) -> int:
    """Consecutive completed weeks (this week excluded) at the target."""
    n = 0
    for w in reversed(sessions_by_week(s, 20, today)[:-1]):
        if w.count >= s.settings.weekly_target:
            n += 1
        else:
            break
    return n


# --------------------------------------------------------------------------
# Body weight
# --------------------------------------------------------------------------


def daily_weights(s: FitState) -> dict[date, float]:
    """The first weigh-in of each day."""
    out: dict[date, float] = {}
    for w in sorted(s.weigh_ins, key=lambda w: w.measured_at):
        out.setdefault(s.day(w.measured_at), w.weight_kg)
    return out


@dataclass
class TrendPoint:
    day: date
    raw: float | None
    avg: float | None


def _mean(values: list[float]) -> float | None:
    if not values:
        return None
    total = 0.0
    for v in values:
        total += v
    return total / len(values)


def weight_trend(s: FitState, days: int, today: date) -> list[TrendPoint]:
    """Raw first-of-day weight plus the trailing 7-day average per day."""
    daily = daily_weights(s)
    out: list[TrendPoint] = []
    for i in range(-days + 1, 1):
        day = today + timedelta(days=i)
        win = [daily[d] for j in range(7) if (d := day - timedelta(days=j)) in daily]
        out.append(TrendPoint(day, daily.get(day), _mean(win)))
    return out


def avg_over(
    s: FitState, from_offset: int, to_offset: int, today: date
) -> float | None:
    daily = daily_weights(s)
    vals = [
        daily[d]
        for i in range(from_offset, to_offset + 1)
        if (d := today + timedelta(days=i)) in daily
    ]
    return _mean(vals)


@dataclass
class WeeklyRate:
    kg: float
    pct: float
    avg: float


def weekly_rate(s: FitState, today: date) -> WeeklyRate | None:
    cur = avg_over(s, -6, 0, today)
    prev = avg_over(s, -13, -7, today)
    if cur is None or prev is None:
        return None
    return WeeklyRate(cur - prev, (cur - prev) / prev * 100, cur)


# --------------------------------------------------------------------------
# Nutrition
# --------------------------------------------------------------------------


def sum_macros(items: Iterable[Macros]) -> Macros:
    t = Macros()
    for m in items:
        t.kcal += m.kcal
        t.protein += m.protein
        t.carbs += m.carbs
        t.fat += m.fat
    return t


def meal_totals(m: MealS) -> Macros:
    return sum_macros(m.items)


def meals_on(s: FitState, day: date) -> list[MealS]:
    return sorted(
        (m for m in s.meals if s.day(m.eaten_at) == day), key=lambda m: m.eaten_at
    )


@dataclass
class DayTotals:
    totals: Macros
    pending: int
    to_review: int
    count: int


def day_totals(s: FitState, day: date) -> DayTotals:
    """A meal waiting for its estimate counts as logged but adds nothing."""
    meals = meals_on(s, day)
    return DayTotals(
        totals=sum_macros(
            meal_totals(m) for m in meals if m.status != "pending_estimate"
        ),
        pending=sum(1 for m in meals if m.status == "pending_estimate"),
        to_review=sum(1 for m in meals if m.status == "estimated"),
        count=len(meals),
    )


def target_for(s: FitState, day: date) -> TargetS | None:
    """The macro target in force on ``day`` (versioned by effective_from)."""
    eligible = [t for t in s.targets if t.effective_from <= day]
    if not eligible:
        return None
    return sorted(eligible, key=lambda t: t.effective_from)[-1]


def adjustment_on(s: FitState, day: date) -> float:
    return next((a.kcal for a in s.adjustments if a.day == day), 0)


def budget_for(s: FitState, day: date) -> TargetS | None:
    """The day's budget: its target plus the burned kcal the user added that
    day. Protein stays; the extra kcal go to carbs and fat in the target's
    carbs:fat calorie ratio (all to carbs when it has neither). Editors use
    ``target_for``, so an eat-back never gets saved into a target."""
    t = target_for(s, day)
    extra = adjustment_on(s, day)
    if t is None or extra <= 0:
        return t
    carb_kcal, fat_kcal = t.carbs * 4, t.fat * 9
    both = carb_kcal + fat_kcal
    carb_share = carb_kcal / both if both > 0 else 1
    return replace(
        t,
        kcal=t.kcal + extra,
        carbs=t.carbs + extra * carb_share / 4,
        fat=t.fat + extra * (1 - carb_share) / 9,
    )


DayVerdict = Literal["hit", "over", "under", "none"]


@dataclass
class DayNutrition:
    day: date
    totals: Macros
    target: TargetS | None
    meals: int
    kcal_ok: bool
    protein_hit: bool
    over: bool
    verdict: DayVerdict


def nutrition_day(s: FitState, day: date) -> DayNutrition:
    dt = day_totals(s, day)
    totals, count = dt.totals, dt.count
    target = budget_for(s, day)
    kcal_ok = (
        target is not None
        and count > 0
        and abs(totals.kcal - target.kcal) <= target.kcal * 0.1
    )
    over = target is not None and totals.kcal > target.kcal * 1.1
    protein_hit = target is not None and totals.protein >= target.protein * 0.9
    verdict: DayVerdict
    if count == 0 or target is None:
        verdict = "none"
    elif over:
        verdict = "over"
    elif kcal_ok:
        verdict = "hit"
    else:
        verdict = "under"
    return DayNutrition(day, totals, target, count, kcal_ok, protein_hit, over, verdict)


def nutrition_days(s: FitState, days: int, today: date) -> list[DayNutrition]:
    return [nutrition_day(s, today + timedelta(days=i)) for i in range(-days + 1, 1)]


@dataclass
class Adherence:
    days: list[DayNutrition]
    logged: int
    calorie: float
    protein: float
    over_days: int
    coverage: float


def adherence(s: FitState, days: int, today: date, offset: int = 0) -> Adherence:
    """Calorie / protein hit rates over the logged days (days with a meal and
    a target). As in the prototype the window is the ``days`` days ending
    ``offset + 1`` days before ``today``: today itself never counts."""
    lst = nutrition_days(s, days + offset + 1, today)[:days]
    logged = [d for d in lst if d.meals > 0 and d.target is not None]

    def pct(n: int) -> float:
        return n / len(logged) if logged else 0

    return Adherence(
        days=lst,
        logged=len(logged),
        calorie=pct(sum(1 for d in logged if d.kcal_ok)),
        protein=pct(sum(1 for d in logged if d.protein_hit)),
        over_days=sum(1 for d in logged if d.over),
        coverage=(sum(1 for d in lst if d.meals >= 2) / len(lst)) if lst else 0,
    )


MealLabel = Literal["breakfast", "lunch", "dinner", "snack"]


def label_for_time(at: datetime, clock: DayClock) -> MealLabel:
    h = at.astimezone(clock.zone).hour
    if 4 <= h < 10:
        return "breakfast"
    if 10 <= h < 15:
        return "lunch"
    if 17 <= h < 22:
        return "dinner"
    return "snack"


def macros_left(s: FitState, day: date) -> Macros | None:
    """Budget (target plus any eat-back) minus everything eaten that day
    (pending estimates excluded)."""
    t = budget_for(s, day)
    if t is None:
        return None
    eaten = sum_macros(
        it
        for m in s.meals
        if s.day(m.eaten_at) == day and m.status != "pending_estimate"
        for it in m.items
    )
    return Macros(
        t.kcal - eaten.kcal,
        t.protein - eaten.protein,
        t.carbs - eaten.carbs,
        t.fat - eaten.fat,
    )


# --------------------------------------------------------------------------
# Templates and period summaries
# --------------------------------------------------------------------------


def next_template(s: FitState) -> TemplateS | None:
    """The template after the one used last (round-robin through the split)."""
    if not s.templates:
        return None
    done = finished(s)
    last_tid = done[-1].template_id if done else None
    i = next((k for k, t in enumerate(s.templates) if t.id == last_tid), -1)
    return s.templates[(i + 1) % len(s.templates)]


def last_of_template(s: FitState, template_id: str) -> WorkoutS | None:
    hits = [w for w in finished(s) if w.template_id == template_id]
    return hits[-1] if hits else None


def overload_rate(s: FitState, days: int, today: date) -> float:
    """Share of lifts (two or more sessions in the window) whose latest e1RM
    beats the first one in the window."""
    start = today - timedelta(days=days)
    up = 0
    n = 0
    for ex in s.exercises:
        h = [
            x
            for x in exercise_history(s, ex.id)
            if s.day(x.workout.started_at) >= start and x.stats.best_e1rm > 0
        ]
        if len(h) < 2:
            continue
        n += 1
        if h[-1].stats.best_e1rm > h[0].stats.best_e1rm + 0.01:
            up += 1
    return up / n if n else 0


@dataclass
class PeriodSummary:
    sessions: int
    target: float
    session_rate: float
    missed: int
    prs: int
    volume: float


def period_summary(
    s: FitState, days: int, today: date, now: datetime, end_offset: int = 0
) -> PeriodSummary:
    first = today + timedelta(days=end_offset - days + 1)
    last = today + timedelta(days=end_offset)
    ws = [w for w in finished(s) if first <= s.day(w.started_at) <= last]
    prs = [p for p in all_prs(s) if first <= s.day(p.at) <= last]
    target = s.settings.weekly_target * days / 7
    volume = 0.0
    for w in ws:
        volume += workout_totals(s, w, now).volume
    return PeriodSummary(
        sessions=len(ws),
        target=target,
        session_rate=min(1, len(ws) / max(1, target)),
        missed=max(0, js_round(target - len(ws))),
        prs=len(prs),
        volume=volume,
    )


def area_rate(
    s: FitState, days: int, today: date, now: datetime, offset: int = 0
) -> float:
    """The fitness area rate: the session rate (``index.ts``
    ``useAreaRate``). Eating is the nutrition area's (ADR-0024)."""
    return period_summary(s, days, today, now, -offset).session_rate


def nutrition_area_rate(
    s: FitState, days: int, today: date, offset: int = 0
) -> float | None:
    """The nutrition area rate: calories on target and protein hit rate
    averaged over the logged days, or None when no day was logged
    (``nutrition/index.ts`` ``useAreaRate``)."""
    a = adherence(s, days, today, offset)
    return (a.calorie + a.protein) / 2 if a.logged else None
