"""Response schemas of the stats module (never table models)."""

import uuid
from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict

from app.modules.stats import logic as L
from app.modules.stats.contract import CalendarItem, Metric, Miss

RangeKey = Literal["7d", "30d", "90d", "1y"]


class LevelOut(BaseModel):
    name: str
    floor: int
    next_name: str | None
    next_floor: int | None


class AreaOut(BaseModel):
    module: str
    enabled: bool
    weight: int
    rate: float | None
    prev: float | None


class OnTargetOut(BaseModel):
    threshold: float
    rate: float | None
    prev_rate: float | None
    on_target: int
    scored: int
    current: int
    best: int
    logged: int


class DayOut(BaseModel):
    day: date
    due: int
    done: int
    on_target: bool | None


class ProgressOut(BaseModel):
    due: int
    done: int


class RingOut(BaseModel):
    due: int
    done: int
    per: dict[str, ProgressOut]


class MetricOut(BaseModel):
    module: str
    key: str
    ref: str
    label: str
    value: str
    number: float | None
    delta: float | None
    good_when: Literal["up", "down"] | None
    shareable: bool


class FacetOut(BaseModel):
    key: str
    label: str
    module: str
    value: float
    prev: float
    off: bool
    href: str
    metric_keys: list[str] | None
    extra: list[MetricOut]


class OverviewOut(BaseModel):
    range: RangeKey
    days: int
    first: date
    last: date
    life_score: int | None
    prev_score: int | None
    delta: int | None
    level: LevelOut
    areas: list[AreaOut]
    on_target: OnTargetOut
    days_series: list[DayOut]
    logged_days: int
    # Trend surfaces show "not enough data" until 3 days are logged.
    gate_open: bool
    today: RingOut
    facets: list[FacetOut]
    metrics: list[MetricOut]


class SliceOut(BaseModel):
    label: str
    value: float


class PointOut(BaseModel):
    day: date
    value: float


class SeriesOut(BaseModel):
    metric: str
    days: int
    kind: Literal["line", "bars", "donut"]
    unit: str
    values: list[float]
    labels: list[str]
    headline: str
    sub: str
    points: list[PointOut]
    slices: list[SliceOut]


class BookEntryOut(BaseModel):
    ref: str
    label: str
    module: str
    value: str
    n: float | None
    unit: str
    good_when: Literal["up", "down"]
    shareable: bool
    delta: float | None


class GoalProgressOut(BaseModel):
    id: uuid.UUID | str
    metric: str
    label: str
    target: float
    unit: str
    comparator: Literal["gte", "lte"]
    period: Literal["week", "month"]
    status: Literal["active", "archived"]
    current: float | None
    value: str | None
    pct: float
    hit: bool
    # True while the goal's module is switched off (Screen time): the goal
    # surfaces leave it out; it is back, with its history, once on again.
    hidden: bool = False


class MetricDetailOut(BaseModel):
    ref: str
    week: BookEntryOut | None
    month: BookEntryOut | None
    goals: list[GoalProgressOut]


class MissOut(BaseModel):
    id: str
    day: date
    title: str
    module: str
    href: str
    kind: str
    note: str | None


class MissesOut(BaseModel):
    data: list[MissOut]
    count: int


class CalendarItemOut(BaseModel):
    id: str
    day: date
    time: str | None
    title: str
    module: str
    done: bool | None
    href: str


class CalendarOut(BaseModel):
    data: list[CalendarItemOut]
    count: int


class TrophyOut(BaseModel):
    id: str
    type: str
    title: str
    value: str
    detail: str
    day: date
    href: str
    share_ref: str | None
    seen: bool


class AchievementOut(BaseModel):
    id: str
    type: str
    title: str
    requirement: str
    pct: float
    text: str
    trophy: TrophyOut | None


class AchievementsOut(BaseModel):
    data: list[AchievementOut]
    count: int
    trophies: list[TrophyOut]
    unseen: int


class TodayOut(BaseModel):
    day: date
    ring: RingOut
    life_score: int | None
    level: str
    on_target_now: bool
    threshold: float
    streak: int


class FacetsOut(BaseModel):
    range: RangeKey
    data: list[FacetOut]


class DailyModuleStatPublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    module: str
    day: date
    due: int
    done: int
    rate: float | None
    metrics: dict[str, object]
    updated_at: datetime
    version: int


class LifeScoreDailyPublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    day: date
    score: int | None
    level: str | None
    rates: dict[str, float]
    weights: dict[str, int]
    due: int
    done: int
    on_target: bool | None
    sealed: bool
    updated_at: datetime
    version: int


class NoPush(BaseModel):
    """Read-only entities accept no pushed fields."""


# ---------------------------------------------------------------- mappers


def metric_out(module: str, m: Metric) -> MetricOut:
    return MetricOut(
        module=module,
        key=m.key,
        ref=f"{module}:{m.key}",
        label=m.label,
        value=m.value,
        number=m.number,
        delta=m.delta,
        good_when=m.good_when,
        shareable=m.shareable,
    )


def facet_out(f: L.FacetView) -> FacetOut:
    return FacetOut(
        key=f.key,
        label=f.label,
        module=f.module,
        value=f.value,
        prev=f.prev,
        off=f.off,
        href=f.href,
        metric_keys=list(f.metric_keys) if f.metric_keys is not None else None,
        extra=[metric_out(f.module, m) for m in f.extra],
    )


def level_out(lv: L.Level) -> LevelOut:
    return LevelOut(
        name=lv.name, floor=lv.floor, next_name=lv.next_name, next_floor=lv.next_floor
    )


def book_entry_out(e: L.BookEntry | None) -> BookEntryOut | None:
    if e is None:
        return None
    return BookEntryOut(
        ref=e.ref,
        label=e.label,
        module=e.module,
        value=e.value,
        n=e.n,
        unit=e.unit,
        good_when=e.good_when,
        shareable=e.shareable,
        delta=e.delta,
    )


def goal_progress_out(g: L.GoalView) -> GoalProgressOut:
    return GoalProgressOut(
        id=g.goal.id,
        metric=g.goal.metric,
        label=g.label,
        target=g.goal.target,
        unit=g.goal.unit,
        comparator=g.goal.comparator,
        period=g.goal.period,
        status=g.goal.status,
        current=g.progress.current,
        value=g.entry.value if g.entry else None,
        pct=g.progress.pct,
        hit=g.progress.hit,
        hidden=g.hidden,
    )


def trophy_out(t: L.Trophy, seen: set[str]) -> TrophyOut:
    return TrophyOut(
        id=t.id,
        type=t.type,
        title=t.title,
        value=t.value,
        detail=t.detail,
        day=t.day,
        href=t.href,
        share_ref=t.share_ref,
        seen=t.id in seen,
    )


def calendar_out(i: CalendarItem) -> CalendarItemOut:
    return CalendarItemOut(
        id=i.id, day=i.day, time=i.time, title=i.title, module=i.module,
        done=i.done, href=i.href,
    )  # fmt: skip


def miss_out(m: Miss, note: str | None) -> MissOut:
    return MissOut(
        id=m.id, day=m.day, title=m.title, module=m.module, href=m.href,
        kind=m.kind, note=note,
    )  # fmt: skip
