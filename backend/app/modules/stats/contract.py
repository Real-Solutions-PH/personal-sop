"""The aggregate-statistic contract (ADR-0014).

Every domain module that feeds the Life Score registers one
:class:`StatsContributor` (in its own ``stats.py``). It mirrors the
prototype's ``shared/prototype/contract.ts`` ``ModuleContract``, so the server
computes exactly what the screens computed on device. ``app.modules.stats``
owns the aggregation: the weighted Life Score, levels, deltas, the on-target
series and streaks, facets, and the daily rollup tables. Modules never
compute a cross-module number themselves.
"""

from dataclasses import dataclass, field
from datetime import date
from typing import Literal, Protocol

from app.shared.context import Ctx

ModuleKey = Literal["habits", "tasks", "fitness", "nutrition", "finance"]
GoodWhen = Literal["up", "down"]


@dataclass(frozen=True)
class Window:
    """Inclusive business-day window ``[first, last]``."""

    first: date
    last: date

    @property
    def days(self) -> int:
        return (self.last - self.first).days + 1


@dataclass(frozen=True)
class Metric:
    key: str
    label: str
    value: str
    number: float | None = None
    delta: float | None = None
    good_when: GoodWhen | None = None
    shareable: bool = True


@dataclass(frozen=True)
class CalendarItem:
    id: str
    day: date
    title: str
    module: ModuleKey
    href: str
    time: str | None = None
    done: bool | None = None


@dataclass(frozen=True)
class Miss:
    id: str
    day: date
    title: str
    module: ModuleKey
    href: str
    kind: str = ""


@dataclass(frozen=True)
class DayProgress:
    due: int
    done: int


@dataclass(frozen=True)
class Achievement:
    id: str
    type: Literal["pr", "streak", "best", "goal", "first"]
    title: str
    value: str
    detail: str
    day: date | None
    href: str
    progress_pct: float = 0.0
    progress_text: str = ""
    earned: bool = False


@dataclass(frozen=True)
class Facet:
    key: str
    label: str
    module: ModuleKey
    value: float
    prev: float
    off: bool = False
    metric_keys: tuple[str, ...] = field(default_factory=tuple)
    href: str = ""


class StatsContributor(Protocol):
    key: ModuleKey
    label: str
    href: str

    def area_rate(self, ctx: Ctx, window: Window) -> float | None:
        """0..1, or None when the module has nothing to rate in the window."""
        ...

    def day_progress(self, ctx: Ctx, days: list[date]) -> dict[date, DayProgress]:
        """Due/done per day: drives the on-target series and today's ring."""
        ...

    def metrics(self, ctx: Ctx, window: Window, prev: Window) -> list[Metric]: ...

    def calendar(self, ctx: Ctx, window: Window) -> list[CalendarItem]: ...

    def misses(self, ctx: Ctx, window: Window) -> list[Miss]: ...

    def achievements(self, ctx: Ctx) -> list[Achievement]: ...

    def facets(self, ctx: Ctx, window: Window, prev: Window) -> list[Facet]: ...


_contributors: dict[str, StatsContributor] = {}

CONTRIBUTOR_MODULES = ("habits", "tasks", "fitness", "nutrition", "finance")


def contributors() -> dict[str, StatsContributor]:
    if not _contributors:
        from importlib import import_module

        for name in CONTRIBUTOR_MODULES:
            contributor = import_module(f"app.modules.{name}.stats").contributor
            _contributors[contributor.key] = contributor
    return _contributors
