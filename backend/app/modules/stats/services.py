"""The aggregate statistic over live module data (ADR-0014).

Every read here is computed live from the module contributors, so a write is
visible on the next read whatever the rollup tables lag (today in particular).
The rollups (``rollups.py``) materialise the same numbers per day for sync
and history; they are caches, never the source of an overview.
"""

from dataclasses import dataclass
from datetime import date, timedelta

from app.modules.profile import public as profile_public
from app.modules.stats import logic as L
from app.modules.stats.contract import (
    CalendarItem,
    DayProgress,
    Facet,
    Metric,
    Miss,
    Window,
    contributors,
)
from app.shared.context import Ctx

RANGES: dict[str, int] = {"7d": 7, "30d": 30, "90d": 90, "1y": 365}
LOGGED_DAYS_GATE = 3


@dataclass(frozen=True)
class Settings:
    enabled: dict[str, bool]
    weights: dict[str, int]
    threshold: float


def settings(ctx: Ctx) -> Settings:
    ms = profile_public.module_settings(ctx)
    return Settings(
        enabled={k: ms[k].enabled for k in L.MODULE_KEYS},
        weights={k: ms[k].weight for k in L.MODULE_KEYS},
        threshold=profile_public.get_profile(ctx).target_threshold,
    )


def window(ctx: Ctx, days: int, offset: int = 0) -> Window:
    """``days`` business days ending ``offset`` days before today."""
    last = ctx.today - timedelta(days=offset)
    return Window(last - timedelta(days=days - 1), last)


def windows(ctx: Ctx, days: int) -> tuple[Window, Window]:
    return window(ctx, days), window(ctx, days, days)


def area_rates(ctx: Ctx, w: Window) -> dict[str, float | None]:
    return {k: c.area_rate(ctx, w) for k, c in contributors().items()}


# ---------------------------------------------------------------- on target


def sealed_days(ctx: Ctx, first: date, last: date) -> list[date]:
    from app.modules.dashboard import public as dashboard_public

    return dashboard_public.sealed_days(ctx, first=first, last=last)


def series_items(ctx: Ctx, first: date, last: date) -> list[L.SeriesItem]:
    """Habit and task calendar items: what ``useDaySeries`` counts."""
    w = Window(first, last)
    out: list[L.SeriesItem] = []
    for k in ("habits", "tasks"):
        out.extend(
            L.SeriesItem(i.day, i.module, bool(i.done))
            for i in contributors()[k].calendar(ctx, w)
        )
    return out


def day_series(ctx: Ctx, s: Settings, length: int) -> list[L.DayResult]:
    first = ctx.today - timedelta(days=length - 1)
    return L.day_series(
        series_items(ctx, first, ctx.today),
        today=ctx.today,
        length=length,
        enabled=s.enabled,
        threshold=s.threshold,
        sealed=sealed_days(ctx, ctx.today, ctx.today),
    )


# ---------------------------------------------------------------- today ring


@dataclass(frozen=True)
class Ring:
    due: int
    done: int
    per: dict[str, DayProgress]


def today_ring(ctx: Ctx, s: Settings) -> Ring:
    """``useTodayRing``: each enabled module's due/done today, done capped at
    due per module."""
    per = {
        k: c.day_progress(ctx, [ctx.today])[ctx.today]
        for k, c in contributors().items()
    }
    due = done = 0
    for k in L.MODULE_KEYS:
        if s.enabled[k]:
            due += per[k].due
            done += min(per[k].done, per[k].due)
    return Ring(due=due, done=done, per=per)


# ---------------------------------------------------------------- metrics


def all_metrics(ctx: Ctx, days: int) -> dict[str, list[Metric]]:
    cur, prev = windows(ctx, days)
    return {k: c.metrics(ctx, cur, prev) for k, c in contributors().items()}


@dataclass(frozen=True)
class LifeScore:
    score: int | None
    prev: int | None
    delta: int | None
    rates: dict[str, float | None]
    prev_rates: dict[str, float | None]


def life_score(ctx: Ctx, s: Settings, days: int) -> LifeScore:
    cur, prev = windows(ctx, days)
    rates, prev_rates = area_rates(ctx, cur), area_rates(ctx, prev)
    score = L.life_score_of(rates, s.weights, s.enabled)
    before = L.life_score_of(prev_rates, s.weights, s.enabled)
    return LifeScore(
        score=score,
        prev=before,
        delta=score - before if score is not None and before is not None else None,
        rates=rates,
        prev_rates=prev_rates,
    )


@dataclass(frozen=True)
class Books:
    week: dict[str, L.BookEntry]
    month: dict[str, L.BookEntry]
    metrics30: dict[str, list[Metric]]
    metrics90: dict[str, list[Metric]] | None = None


def books(ctx: Ctx, s: Settings, series: list[L.DayResult]) -> Books:
    """``useMetricBook``: the 7-day and 30-day books goals are measured on."""
    m7, m30 = all_metrics(ctx, 7), all_metrics(ctx, 30)
    o7, o30 = L.on_target(series, 7), L.on_target(series, 30)
    return Books(
        week=L.metric_book(m7, life_score(ctx, s, 7).score, o7.rate, s.enabled),
        month=L.metric_book(m30, life_score(ctx, s, 30).score, o30.rate, s.enabled),
        metrics30=m30,
    )


def goal_views(ctx: Ctx, b: Books) -> list[L.GoalView]:
    from app.modules.dashboard import public as dashboard_public

    return L.goal_views(dashboard_public.goal_specs(ctx), b.week, b.month, b.metrics30)


# ---------------------------------------------------------------- facets


def facets(
    ctx: Ctx, s: Settings, days: int, ls: LifeScore | None = None
) -> list[L.FacetView]:
    ls = ls or life_score(ctx, s, days)
    cur, prev = windows(ctx, days)
    reported: dict[str, Facet] = {}
    for k in ("habits", "fitness"):
        for f in contributors()[k].facets(ctx, cur, prev):
            reported[f.key] = f

    def pair(key: str) -> tuple[float, float]:
        f = reported.get(key)
        return (f.value, f.prev) if f else (0.0, 0.0)

    return L.compose_facets(
        rates=ls.rates,
        prev_rates=ls.prev_rates,
        enabled=s.enabled,
        routines=pair("routines"),
        training=pair("training"),
        nutrition=pair("nutrition"),
    )


# ---------------------------------------------------------------- overview


@dataclass(frozen=True)
class OverviewResult:
    days: int
    window: Window
    settings: Settings
    life: LifeScore
    level: L.Level
    target: L.OnTarget
    ring: Ring
    facets: list[L.FacetView]
    metrics: dict[str, list[Metric]]

    @property
    def gate_open(self) -> bool:
        return self.target.logged >= LOGGED_DAYS_GATE


def overview(ctx: Ctx, *, days: int) -> OverviewResult:
    s = settings(ctx)
    cur, prev = windows(ctx, days)
    ls = life_score(ctx, s, days)
    series = day_series(ctx, s, L.series_length(days))
    return OverviewResult(
        days=days,
        window=cur,
        settings=s,
        life=ls,
        level=L.level_for(ls.score),
        target=L.on_target(series, days),
        ring=today_ring(ctx, s),
        facets=facets(ctx, s, days, ls),
        metrics={
            k: c.metrics(ctx, cur, prev)
            for k, c in contributors().items()
            if s.enabled[k]
        },
    )


# ---------------------------------------------------------------- feeds


def calendar(ctx: Ctx, first: date, last: date) -> list[CalendarItem]:
    """``useAllCalendar``: every enabled module's items, by day then time."""
    s = settings(ctx)
    w = Window(first, last)
    items = [
        i for k, c in contributors().items() if s.enabled[k] for i in c.calendar(ctx, w)
    ]
    return sorted(items, key=lambda i: (i.day, i.time or "99:99"))


def misses(ctx: Ctx, first: date, last: date) -> list[Miss]:
    """``useAllMisses``: every enabled module's misses, newest day first."""
    s = settings(ctx)
    w = Window(first, last)
    items = [
        m for k, c in contributors().items() if s.enabled[k] for m in c.misses(ctx, w)
    ]
    return sorted(items, key=lambda m: m.day, reverse=True)


@dataclass(frozen=True)
class AchievementsResult:
    items: list[L.AchievementView]
    trophies: list[L.Trophy]
    seen: set[str]


def achievements(ctx: Ctx) -> AchievementsResult:
    s = settings(ctx)
    series = day_series(ctx, s, L.series_length(365))
    b = books(ctx, s, series)
    m90 = all_metrics(ctx, 90)
    from app.modules.dashboard import public as dashboard_public

    items = L.achievements(
        series=series,
        current=L.on_target(series, 365).current,
        m30=b.metrics30,
        m90=m90,
        goals=goal_views(ctx, b),
        wrapup_days=dashboard_public.sealed_days(ctx),
        enabled=s.enabled,
        today=ctx.today,
    )
    known = {a.id for a in items}
    # Firsts a module reports that the dashboard list does not derive itself
    # (first workout, first PR). Streak and PR milestones are already derived
    # above from the same metrics, so the modules' own copies are not repeated.
    for k, c in contributors().items():
        if not s.enabled[k]:
            continue
        for a in c.achievements(ctx):
            if a.type != "first" or a.id in known:
                continue
            known.add(a.id)
            items.append(
                L.AchievementView(
                    id=a.id,
                    type=a.type,
                    title=a.title,
                    requirement=a.detail,
                    pct=a.progress_pct,
                    text=a.progress_text,
                    trophy=L.Trophy(
                        id=f"{a.id}-{a.day.isoformat()}",
                        type=a.type,
                        title=a.title,
                        value=a.value,
                        detail=a.detail,
                        day=a.day,
                        href=a.href,
                    )
                    if a.earned and a.day is not None
                    else None,
                )
            )
    seen = set(profile_public.get_profile(ctx).seen_trophies or [])
    return AchievementsResult(items=items, trophies=L.trophies(items), seen=seen)


@dataclass(frozen=True)
class MetricDetail:
    ref: str
    week: L.BookEntry | None
    month: L.BookEntry | None
    goals: list[L.GoalView]


def metric_detail(ctx: Ctx, ref: str) -> MetricDetail | None:
    s = settings(ctx)
    series = day_series(ctx, s, L.series_length(30))
    b = books(ctx, s, series)
    week, month = b.week.get(ref), b.month.get(ref)
    if week is None and month is None:
        return None
    goals = [g for g in goal_views(ctx, b) if g.goal.metric == ref]
    return MetricDetail(ref=ref, week=week, month=month, goals=goals)
