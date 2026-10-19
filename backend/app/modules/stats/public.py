"""Cross-module contract of the stats module (implemented by stats)."""

from dataclasses import dataclass, field
from datetime import date

from app.modules.stats.contract import CalendarItem, Metric, Miss
from app.modules.stats.logic import (
    AchievementView,
    FacetView,
    GoalView,
    OnTarget,
    Trophy,
)
from app.modules.stats.rollups import install as _install_drain
from app.shared.context import Ctx

# Every writer imports ``mark_dirty`` from here, so the after-commit drain is
# attached before the first dirty mark can exist.
_install_drain()

LEVELS: tuple[tuple[int, str], ...] = (
    (0, "Getting started"),
    (40, "Building"),
    (55, "Steady"),
    (65, "Strong"),
    (75, "Excellent"),
    (85, "Peak"),
)


@dataclass(frozen=True)
class AreaRate:
    module: str
    enabled: bool
    weight: int
    rate: float | None
    prev: float | None


@dataclass(frozen=True)
class Overview:
    """The one aggregate statistic (ADR-0014)."""

    days: int
    first: date
    last: date
    life_score: int | None
    level: str | None
    delta: int | None
    areas: list[AreaRate]
    on_target_rate: float | None
    streak: int
    best_streak: int
    logged_days: int
    today_due: int
    today_done: int
    facets: list[dict[str, object]] = field(default_factory=list)
    metrics: list[dict[str, object]] = field(default_factory=list)


def overview(ctx: Ctx, *, days: int) -> Overview:
    """The one aggregate statistic over the last ``days`` business days,
    computed live (today included). Every overall-stat surface reads this."""
    from app.modules.stats import schema, services

    o = services.overview(ctx, days=days)
    return Overview(
        days=days,
        first=o.window.first,
        last=o.window.last,
        life_score=o.life.score,
        level=o.level.name,
        delta=o.life.delta,
        areas=[
            AreaRate(
                module=k,
                enabled=o.settings.enabled[k],
                weight=o.settings.weights[k],
                rate=o.life.rates.get(k),
                prev=o.life.prev_rates.get(k),
            )
            for k in o.settings.enabled
        ],
        on_target_rate=o.target.rate,
        streak=o.target.current,
        best_streak=o.target.best,
        logged_days=o.target.logged,
        today_due=o.ring.due,
        today_done=o.ring.done,
        facets=[schema.facet_out(f).model_dump(mode="json") for f in o.facets],
        metrics=[
            schema.metric_out(k, m).model_dump(mode="json")
            for k, ms in o.metrics.items()
            for m in ms
        ],
    )


def series(ctx: Ctx, *, metric: str, days: int) -> list[tuple[date, float | None]]:
    """Daily values of a companion/tracker metric (life, habits, tasks,
    spend, netWorth, workouts, weight, nutrition). ``workouts`` is weekly
    (keyed by week start). ``spendCats`` is not a time series: use the
    ``/stats/series`` route for its slices."""
    from app.modules.stats.series import build

    if metric == "spendCats":
        raise ValueError("spendCats is not a time series")
    return [(day, value) for day, value in build(ctx, metric, days).points]


def goals_with_progress(ctx: Ctx) -> list["GoalView"]:
    """Every goal (active and archived) measured against its period's metric
    book: the progress the goal screens and share cards show."""
    from app.modules.stats import logic as L
    from app.modules.stats import services

    s = services.settings(ctx)
    series_ = services.day_series(ctx, s, L.series_length(30))
    return services.goal_views(ctx, services.books(ctx, s, series_))


def metric_value(ctx: Ctx, *, ref: str, period: str) -> float | None:
    """The current number behind a metric ref (``"life"``, ``"onTarget"`` or
    ``"<module>:<key>"``) for a week or month goal; None when unmeasured."""
    from app.modules.stats import logic as L
    from app.modules.stats import services

    s = services.settings(ctx)
    b = services.books(ctx, s, services.day_series(ctx, s, L.series_length(30)))
    entry = (b.week if period == "week" else b.month).get(ref)
    return entry.n if entry else None


DIRTY_KEY = "stats_dirty"


def mark_dirty(ctx: Ctx, *, module: str, day: date) -> None:
    """A write changed ``module`` on ``day``: queue the rollup recompute.
    Cheap and idempotent; call it from every use case that changes a day.

    Collects ``(owner, module, day)`` on the session; the stats module drains
    the set after commit and enqueues the debounced recompute.
    """
    dirty: set[tuple[object, str, date]] = ctx.session.info.setdefault(DIRTY_KEY, set())
    dirty.add((ctx.user_id, module, day))


@dataclass(frozen=True)
class DayRing:
    """The Today ring for one day: enabled modules' due/done (done capped at
    due per module), the user's threshold and whether the day is on target."""

    day: date
    due: int
    done: int
    per: dict[str, tuple[int, int]]
    threshold: float
    on_target: bool


def day_ring(ctx: Ctx, *, day: date | None = None) -> DayRing:
    from app.modules.stats import services
    from app.modules.stats.contract import contributors

    the_day = day or ctx.today
    s = services.settings(ctx)
    per: dict[str, tuple[int, int]] = {}
    due = done = 0
    for k, c in contributors().items():
        p = c.day_progress(ctx, [the_day])[the_day]
        per[k] = (p.due, p.done)
        if s.enabled[k]:
            due += p.due
            done += min(p.done, p.due)
    return DayRing(
        day=the_day,
        due=due,
        done=done,
        per=per,
        threshold=s.threshold,
        on_target=due > 0 and done / due >= s.threshold,
    )


def calendar(ctx: Ctx, *, first: date, last: date) -> list["CalendarItem"]:
    from app.modules.stats import services

    return services.calendar(ctx, first, last)


def misses(ctx: Ctx, *, first: date, last: date) -> list["Miss"]:
    from app.modules.stats import services

    return services.misses(ctx, first, last)


@dataclass(frozen=True)
class TrophyCase:
    items: list["AchievementView"]
    trophies: list["Trophy"]
    seen: set[str]


def trophy_case(ctx: Ctx) -> TrophyCase:
    from app.modules.stats import services

    r = services.achievements(ctx)
    return TrophyCase(items=r.items, trophies=r.trophies, seen=r.seen)


@dataclass(frozen=True)
class CardStats:
    """What the share cards read (``useCardData``) apart from the profile."""

    life30: Overview
    target7: OnTarget
    target30: OnTarget
    metrics7: dict[str, list["Metric"]]
    metrics30: dict[str, list["Metric"]]
    facets7: list["FacetView"]
    facets30: list["FacetView"]
    enabled: dict[str, bool]


def card_stats(ctx: Ctx) -> CardStats:
    from app.modules.stats import logic as L
    from app.modules.stats import services

    s = services.settings(ctx)
    series_ = services.day_series(ctx, s, L.series_length(30))
    ls7 = services.life_score(ctx, s, 7)
    return CardStats(
        life30=overview(ctx, days=30),
        target7=L.on_target(series_, 7),
        target30=L.on_target(series_, 30),
        metrics7=services.all_metrics(ctx, 7),
        metrics30=services.all_metrics(ctx, 30),
        facets7=services.facets(ctx, s, 7, ls7),
        facets30=services.facets(ctx, s, 30),
        enabled=s.enabled,
    )


__all__ = [
    "DIRTY_KEY",
    "LEVELS",
    "AchievementView",
    "AreaRate",
    "CalendarItem",
    "CardStats",
    "DayRing",
    "FacetView",
    "GoalView",
    "Metric",
    "Miss",
    "OnTarget",
    "Trophy",
    "TrophyCase",
    "calendar",
    "card_stats",
    "day_ring",
    "misses",
    "trophy_case",
    "Overview",
    "goals_with_progress",
    "mark_dirty",
    "metric_value",
    "overview",
    "series",
]
