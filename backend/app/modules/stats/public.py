"""Cross-module contract of the stats module (implemented by stats)."""

from dataclasses import dataclass, field
from datetime import date

from app.shared.context import Ctx

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
    raise NotImplementedError


def series(ctx: Ctx, *, metric: str, days: int) -> list[tuple[date, float | None]]:
    """Daily values of a companion/tracker metric (life, habits, tasks,
    spend, netWorth, workouts, weight, nutrition)."""
    raise NotImplementedError


DIRTY_KEY = "stats_dirty"


def mark_dirty(ctx: Ctx, *, module: str, day: date) -> None:
    """A write changed ``module`` on ``day``: queue the rollup recompute.
    Cheap and idempotent; call it from every use case that changes a day.

    Collects ``(owner, module, day)`` on the session; the stats module drains
    the set after commit and enqueues the debounced recompute.
    """
    dirty: set[tuple[object, str, date]] = ctx.session.info.setdefault(DIRTY_KEY, set())
    dirty.add((ctx.user_id, module, day))
