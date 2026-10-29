"""The screen-time stats contributor (ADR-0014; spec
2026-10-29-screen-time-design, "Day score").

The area rate is :func:`app.modules.screen.logic.area_rate` over the
window's rows: each closed day scores the mean of its groups' day scores
(groups with a zero budget are never scored), the window the mean of those
days; ``None`` (the Life Score skips the area) with no closed day.

A day is due once per budgeted group with a closed row that day and done
when that group stayed within its budget. Calendar, misses and achievements
are empty: screen time has no items of its own to list. The hexagon corner
comes from ``compose_facets`` (the area rate), so ``facets`` is empty too.

The one metric, ``screen.used``, is the main figure (the All apps group, or
the busiest custom group on a day without it) a closed day on average. Every
minute figure is a lower bound, so it reads "≥ N min". The device's copy is
``shared/prototype/screen/index.ts``.
"""

import uuid
from collections import defaultdict
from datetime import date

from app.modules.screen import logic as L
from app.modules.screen import services as svc
from app.modules.screen.models import ScreenDay, ScreenGroup
from app.modules.stats.contract import (
    Achievement,
    CalendarItem,
    DayProgress,
    Facet,
    Metric,
    Miss,
    ModuleKey,
    Window,
)
from app.modules.stats.logic import js_round
from app.shared.context import Ctx

KEY: ModuleKey = "screen"


def _budgets(groups: list[ScreenGroup]) -> dict[uuid.UUID, int]:
    return {g.id: g.budget_min for g in groups}


def main_used(days: list[ScreenDay], groups: list[ScreenGroup]) -> dict[date, int]:
    """Per closed day, the person's screen time lower bound: the ``all``
    group's figure where that day has one, else the highest custom group's
    (the groups may overlap, so they are never added up)."""
    kinds = {g.id: g.kind for g in groups}
    alls: dict[date, int] = {}
    custom: dict[date, int] = defaultdict(int)
    for d in days:
        if not d.closed:
            continue
        kind = kinds.get(d.group_id)
        if kind == "all":
            alls[d.day] = max(alls.get(d.day, 0), d.used_min)
        elif kind == "custom":
            custom[d.day] = max(custom[d.day], d.used_min)
    return {**custom, **alls}


class ScreenContributor:
    key: ModuleKey = KEY
    label = "Screen time"
    href = "/screen"

    def area_rate(self, ctx: Ctx, window: Window) -> float | None:
        rows = svc.days(ctx, window.first, window.last)
        if not rows:
            return None
        return L.area_rate(
            [(r.day, r.group_id, r.used_min, r.closed) for r in rows],
            _budgets(svc.groups(ctx)),
        )

    def day_progress(self, ctx: Ctx, days: list[date]) -> dict[date, DayProgress]:
        out = {d: DayProgress(due=0, done=0) for d in days}
        if not days:
            return out
        budgets = _budgets(svc.groups(ctx))
        due: dict[date, int] = defaultdict(int)
        done: dict[date, int] = defaultdict(int)
        for r in svc.days(ctx, min(days), max(days)):
            budget = budgets.get(r.group_id)
            if not r.closed or budget is None or budget <= 0 or r.day not in out:
                continue
            due[r.day] += 1
            done[r.day] += int(r.used_min <= budget)
        for d in due:
            out[d] = DayProgress(due=due[d], done=done[d])
        return out

    def metrics(self, ctx: Ctx, window: Window, prev: Window) -> list[Metric]:
        groups = svc.groups(ctx)

        def read(w: Window) -> int | None:
            """The main figure a closed day on average (``None`` without one)."""
            by_day = main_used(svc.days(ctx, w.first, w.last), groups)
            return js_round(sum(by_day.values()) / len(by_day)) if by_day else None

        cur, before = read(window), read(prev)
        return [
            Metric(
                "screen.used",
                "Screen time (at least)",
                "—" if cur is None else f"≥ {cur} min",
                cur,
                cur - before if cur is not None and before is not None else None,
                "down",
            )
        ]

    def calendar(self, ctx: Ctx, window: Window) -> list[CalendarItem]:
        return []

    def misses(self, ctx: Ctx, window: Window) -> list[Miss]:
        return []

    def achievements(self, ctx: Ctx) -> list[Achievement]:
        return []

    def facets(self, ctx: Ctx, window: Window, prev: Window) -> list[Facet]:
        return []


contributor = ScreenContributor()
