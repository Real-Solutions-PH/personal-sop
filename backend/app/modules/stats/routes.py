"""REST routes of the stats module: the one aggregate statistic and the feeds
the Today, Stats, Trophies and companion screens read (ADR-0014)."""

from datetime import date, timedelta
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Query

from app.modules.iam.deps import require_permission
from app.modules.stats import logic as L
from app.modules.stats import schema as S
from app.modules.stats import services
from app.modules.stats.series import SERIES_METRICS, SeriesMetric, build
from app.shared.context import ReadCtxDep
from app.shared.domain import invalid, not_found
from app.shared.pagination import PaginationDep

router = APIRouter(prefix="/stats", tags=["stats"])

READ = [Depends(require_permission("stats:read"))]

# A calendar or misses window is bounded by the longest range a screen shows.
MAX_SPAN_DAYS = 400

Range = Annotated[S.RangeKey, Query()]


def _ring(r: services.Ring) -> S.RingOut:
    return S.RingOut(
        due=r.due,
        done=r.done,
        per={k: S.ProgressOut(due=p.due, done=p.done) for k, p in r.per.items()},
    )


def _span(
    first: date | None, last: date | None, today: date, default: int
) -> tuple[date, date]:
    last = last or today
    first = first or last - timedelta(days=default - 1)
    if last < first:
        raise invalid("range_invalid", "The range ends before it starts")
    if (last - first).days + 1 > MAX_SPAN_DAYS:
        raise invalid("range_too_long", "The range is too long")
    return first, last


@router.get("/overview", response_model=S.OverviewOut, dependencies=READ)
def overview(ctx: ReadCtxDep, range: Range = "7d") -> Any:
    """The one overall statistic: Life Score, level, delta, on-target rate and
    streaks, today's ring, facets and headline metrics, computed live."""
    days = services.RANGES[range]
    o = services.overview(ctx, days=days)
    return S.OverviewOut(
        range=range,
        days=days,
        first=o.window.first,
        last=o.window.last,
        life_score=o.life.score,
        prev_score=o.life.prev,
        delta=o.life.delta,
        level=S.level_out(o.level),
        areas=[
            S.AreaOut(
                module=k,
                enabled=o.settings.enabled[k],
                weight=o.settings.weights[k],
                rate=o.life.rates.get(k),
                prev=o.life.prev_rates.get(k),
            )
            for k in L.MODULE_KEYS
        ],
        on_target=S.OnTargetOut(
            threshold=o.settings.threshold,
            rate=o.target.rate,
            prev_rate=o.target.prev_rate,
            on_target=o.target.on_target,
            scored=o.target.scored,
            current=o.target.current,
            best=o.target.best,
            logged=o.target.logged,
        ),
        days_series=[
            S.DayOut(day=d.day, due=d.due, done=d.done, on_target=d.on_target)
            for d in o.target.range
        ],
        logged_days=o.target.logged,
        gate_open=o.gate_open,
        today=_ring(o.ring),
        facets=[S.facet_out(f) for f in o.facets],
        metrics=[S.metric_out(k, m) for k, ms in o.metrics.items() for m in ms],
    )


@router.get("/series", response_model=S.SeriesOut, dependencies=READ)
def series(
    ctx: ReadCtxDep,
    metric: SeriesMetric,
    days: Annotated[int, Query(ge=1, le=365)] = 30,
) -> Any:
    """A companion/tracker chart (``useSeries``)."""
    s = build(ctx, metric, days)
    return S.SeriesOut(
        metric=s.metric,
        days=s.days,
        kind=s.kind,
        unit=s.unit,
        values=s.values,
        labels=s.labels,
        headline=s.headline,
        sub=s.sub,
        points=[S.PointOut(day=d, value=v) for d, v in s.points],
        slices=[S.SliceOut(label=x.label, value=x.value) for x in s.slices],
    )


@router.get("/series/metrics", response_model=list[str], dependencies=READ)
def series_metrics() -> Any:
    return list(SERIES_METRICS)


@router.get("/metrics/{ref}", response_model=S.MetricDetailOut, dependencies=READ)
def metric_detail(ctx: ReadCtxDep, ref: str) -> Any:
    """One metric (``life``, ``onTarget`` or ``<module>:<key>``) this week and
    this month, with the goals set on it."""
    d = services.metric_detail(ctx, ref)
    if d is None:
        raise not_found("metric")
    return S.MetricDetailOut(
        ref=d.ref,
        week=S.book_entry_out(d.week),
        month=S.book_entry_out(d.month),
        goals=[S.goal_progress_out(g) for g in d.goals],
    )


@router.get("/misses", response_model=S.MissesOut, dependencies=READ)
def misses(
    ctx: ReadCtxDep,
    page: PaginationDep,
    from_: Annotated[date | None, Query(alias="from")] = None,
    to: date | None = None,
) -> Any:
    """Every enabled module's misses in the range (default the last 7
    days), newest first, with the user's note on each."""
    from app.modules.dashboard import public as dashboard_public

    first, last = _span(from_, to, ctx.today, 7)
    items = services.misses(ctx, first, last)
    notes = dashboard_public.miss_notes(ctx, [m.id for m in items])
    pageful = items[page.skip : page.skip + page.limit]
    return S.MissesOut(
        data=[S.miss_out(m, notes.get(m.id)) for m in pageful], count=len(items)
    )


@router.get("/calendar", response_model=S.CalendarOut, dependencies=READ)
def calendar(
    ctx: ReadCtxDep,
    page: PaginationDep,
    from_: Annotated[date | None, Query(alias="from")] = None,
    to: date | None = None,
) -> Any:
    """Every enabled module's calendar items in the range (default today),
    by day then time."""
    first, last = _span(from_, to, ctx.today, 1)
    items = services.calendar(ctx, first, last)
    pageful = items[page.skip : page.skip + page.limit]
    return S.CalendarOut(data=[S.calendar_out(i) for i in pageful], count=len(items))


@router.get("/achievements", response_model=S.AchievementsOut, dependencies=READ)
def achievements(ctx: ReadCtxDep) -> Any:
    """Trophy case: every achievement with progress, the earned trophies
    newest first, and which the user has already seen."""
    r = services.achievements(ctx)
    trophies = [S.trophy_out(t, r.seen) for t in r.trophies]
    return S.AchievementsOut(
        data=[
            S.AchievementOut(
                id=a.id,
                type=a.type,
                title=a.title,
                requirement=a.requirement,
                pct=a.pct,
                text=a.text,
                trophy=S.trophy_out(a.trophy, r.seen) if a.trophy else None,
            )
            for a in r.items
        ],
        count=len(r.items),
        trophies=trophies,
        unseen=sum(1 for t in trophies if not t.seen),
    )


@router.get("/today", response_model=S.TodayOut, dependencies=READ)
def today(ctx: ReadCtxDep) -> Any:
    """Today's ring, the 7-day Life Score and the on-target streak."""
    s = services.settings(ctx)
    ring = services.today_ring(ctx, s)
    ls = services.life_score(ctx, s, 7)
    target = L.on_target(services.day_series(ctx, s, L.series_length(7)), 7)
    return S.TodayOut(
        day=ctx.today,
        ring=_ring(ring),
        life_score=ls.score,
        level=L.level_for(ls.score).name,
        on_target_now=ring.due > 0 and ring.done / ring.due >= s.threshold,
        threshold=s.threshold,
        streak=target.current,
    )


@router.get("/facets", response_model=S.FacetsOut, dependencies=READ)
def facets(ctx: ReadCtxDep, range: Range = "7d") -> Any:
    s = services.settings(ctx)
    return S.FacetsOut(
        range=range,
        data=[S.facet_out(f) for f in services.facets(ctx, s, services.RANGES[range])],
    )
