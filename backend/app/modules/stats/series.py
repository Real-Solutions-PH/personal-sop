"""Daily series for the companion and tracker charts (``useSeries`` in
``mobile/src/prototype/companion/blocks.tsx``).

The contract (``StatsContributor``) has no series hook, so the module-specific
series read each module's own state loader and pure calculations, the same
read-side pair its ``stats.py`` contributor uses. They never write.
"""

import math
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import date, timedelta
from typing import Literal

from app.modules.stats import logic as L
from app.shared.context import Ctx
from app.shared.currency import Currency

SeriesMetric = Literal[
    "life",
    "habits",
    "tasks",
    "spend",
    "spendCats",
    "netWorth",
    "workouts",
    "weight",
    "nutrition",
]
SERIES_METRICS: tuple[str, ...] = SeriesMetric.__args__  # type: ignore[attr-defined]
# Money series carry integer centavos; the client formats them.
MONEY_METRICS = frozenset({"spend", "spendCats", "netWorth"})


@dataclass(frozen=True)
class Slice:
    label: str
    value: float


@dataclass(frozen=True)
class Series:
    metric: str
    days: int
    kind: Literal["line", "bars", "donut"]
    values: list[float]
    labels: list[str]
    headline: str
    sub: str
    unit: Literal["", "%", "minor", "kcal", "kg"] = ""
    # The underlying (day, value) points: daily, or per week start for
    # ``workouts``; empty for ``spendCats``. ``values`` is what the chart
    # draws (weekly means once a bar series passes 31 days).
    points: list[tuple[date, float]] = field(default_factory=list)
    slices: list[Slice] = field(default_factory=list)


def _avg(xs: list[float]) -> float:
    return sum(xs) / len(xs) if xs else 0.0


def _keys(today: date, n: int) -> list[date]:
    return [today - timedelta(days=n - 1 - i) for i in range(n)]


def _short(d: date) -> str:
    return f"{d.month}/{d.day}"


def _weekly(vals: list[float]) -> list[float]:
    """Weekly means of a daily list, chunked from the start."""
    return [_avg(vals[i : i + 7]) for i in range(0, len(vals), 7)]


def _money(cur: Currency) -> Callable[[float], str]:
    """Whole units in the user's currency, ``Math.round`` like the prototype."""
    return lambda minor: f"{cur.prefix}{L.js_round(minor / 100):,}"


def _bars(
    metric: str,
    n: int,
    keys: list[date],
    vals: list[float],
    fmt: Callable[[float], str],
    label: str,
    unit: Literal["", "%", "minor", "kcal", "kg"],
) -> Series:
    points = list(zip(keys, vals, strict=True))
    if n > 31:
        return Series(metric, n, "line", _weekly(vals), [], fmt(_avg(vals)),
                      f"{label} · daily average", unit, points)  # fmt: skip
    return Series(metric, n, "bars", vals, [_short(k) for k in keys],
                  fmt(_avg(vals)), f"{label} · daily average", unit, points)  # fmt: skip


def build(ctx: Ctx, metric: str, n: int) -> Series:
    today = ctx.today
    keys = _keys(today, n)

    if metric == "life":
        from app.modules.stats import services

        s = services.settings(ctx)
        series = services.day_series(ctx, s, max(n, 7))[-n:]
        vals = [
            float(L.js_round(d.done / d.due * 100)) if d.due else 0.0 for d in series
        ]
        return Series(metric, n, "line", vals, [], f"{L.js_round(_avg(vals))}%",
                      "Of each day's plan done, on average", "%",
                      [(d.day, v) for d, v in zip(series, vals, strict=True)])  # fmt: skip

    if metric == "habits":
        from app.modules.habits import logic as H
        from app.modules.habits.views import load_world

        w = load_world(ctx, since=keys[0])
        days = H.overall_days(w.active_views(), w.idx, keys[0], today, today)
        vals = [float(L.js_round((d.rate or 0) * 100)) for d in days]
        return Series(metric, n, "line", vals, [], f"{L.js_round(_avg(vals))}%",
                      "Habits completed per day", "%",
                      list(zip(keys, vals, strict=True)))  # fmt: skip

    if metric == "tasks":
        from app.modules.tasks import repo as tasks_repo

        state = tasks_repo.load_state(ctx).state
        done_days = [
            ctx.clock.day_of(t.completed_at)
            for t in state.tasks
            if t.completed_at is not None
        ]
        vals = [float(sum(1 for d in done_days if d == k)) for k in keys]
        return _bars(metric, n, keys, vals, lambda v: f"{v:.1f}", "Tasks done", "")

    if metric in ("spend", "spendCats", "netWorth"):
        from app.modules.finance import calc as F
        from app.modules.finance import repo as finance_repo

        fin = finance_repo.read_state(ctx)
        if metric == "spend":
            vals = [float(max(0, F.spend_in(fin, k, k, None))) for k in keys]
            return _bars(
                metric, n, keys, vals, _money(ctx.currency), "Spending", "minor"
            )
        if metric == "spendCats":
            flow = F.flow_in(fin, keys[0], today)
            cats = F.cat_map(fin)
            top = sorted(
                ((cid, v) for cid, v in flow.by_cat.items() if v > 0),
                key=lambda x: -x[1],
            )[:6]
            slices = [
                Slice(cats[cid].name if cid in cats else "Other", float(v))
                for cid, v in top
            ]
            return Series(metric, n, "donut", [x.value for x in slices], [],
                          _money(ctx.currency)(flow.spend), f"Spent in the last {n} days", "minor",
                          [], slices)  # fmt: skip
        nw = [float(v) for v in F.net_worth_series(fin, n)]
        change = nw[-1] - nw[0] if nw else 0.0
        sign = "+" if change >= 0 else "−"
        return Series(metric, n, "line", nw, [], f"{sign}{_money(ctx.currency)(abs(change))}",
                      f"Net worth change over {n} days", "minor",
                      list(zip(keys[-len(nw):], nw, strict=True)) if nw else [])  # fmt: skip

    if metric in ("workouts", "weight", "nutrition"):
        from app.modules.fitness import calc as C
        from app.modules.fitness import repo as fitness_repo

        fit = fitness_repo.load_state(ctx, meals=metric == "nutrition")
        if metric == "workouts":
            weeks = C.sessions_by_week(fit, max(2, math.ceil(n / 7)), today)
            counts = [float(w.count) for w in weeks]
            return Series(metric, n, "bars", counts, [_short(w.start) for w in weeks],
                          f"{_avg(counts):.1f}", "Sessions per week", "",
                          [(w.start, float(w.count)) for w in weeks])  # fmt: skip
        if metric == "weight":
            pts = [p for p in C.weight_trend(fit, n, today) if p.avg is not None]
            vals = [float(p.avg) for p in pts if p.avg is not None]
            change = vals[-1] - vals[0] if len(vals) > 1 else 0.0
            arrow = "▼" if change <= 0 else "▲"
            return Series(metric, n, "line", vals, [],
                          f"{vals[-1]:.1f} kg" if vals else "—",
                          f"{arrow} {abs(change):.1f} kg over {n} days (7-day average)",
                          "kg", list(zip([p.day for p in pts], vals, strict=True)))  # fmt: skip
        kcal = [
            float(L.js_round(d.totals.kcal)) for d in C.nutrition_days(fit, n, today)
        ]
        return _bars(metric, n, keys, kcal, lambda v: f"{L.js_round(v)} kcal",
                     "Calories", "kcal")  # fmt: skip

    raise ValueError("unknown series metric")
