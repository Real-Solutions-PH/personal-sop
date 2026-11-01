"""Fern's general read over a person's records (``query_records``).

``lookup`` answers a fixed set of questions, so anything else about the
past ("what did I eat on Tuesday", "my average protein these two weeks",
"where does my money go on weekends") had no tool. This reads any area over
any range of days, filtered and grouped, and does the arithmetic here: the
model is told never to add numbers itself.

Each area's rows come from that module's ``public`` contract as flat dicts
with a ``day`` (the person's business day, ISO); :func:`summarize` is pure.
"""

from collections.abc import Callable, Sequence
from datetime import date, timedelta
from typing import Any

from app.modules.finance import public as finance
from app.modules.fitness import public as fitness
from app.modules.focus import public as focus
from app.modules.habits import public as habits
from app.modules.tasks import public as tasks
from app.shared.context import Ctx
from app.shared.currency import money

WEEKDAYS = ("Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun")
TIME_KEYS = ("day", "week", "month", "weekday")
MAX_DAYS = 366
RECORD_LIMIT = 60
GROUP_LIMIT = 60


class Area:
    def __init__(
        self,
        rows: Callable[[Ctx, date, date], list[dict[str, Any]]],
        metrics: tuple[str, ...],
        fields: tuple[str, ...],
        *,
        only_by: dict[str, str] | None = None,
    ) -> None:
        self.rows, self.metrics, self.fields = rows, metrics, fields
        # A metric that only adds up within one group: habit values are
        # glasses, minutes or pages, so they total per habit only.
        self.only_by = only_by or {}


# The numbers each area sums, and the text fields it can be grouped by or
# searched in. Money is in minor units (``_minor``) until the very end. A
# row leaves out a metric that doesn't apply to it (an income row has no
# ``spent_minor``) and holds None for one that applies but isn't known.
AREAS: dict[str, Area] = {
    "meals": Area(
        fitness.meal_item_facts,
        ("kcal", "protein", "carbs", "fat", "fiber", "sat_fat", "sugar", "sodium"),
        ("meal", "food"),
    ),
    "workouts": Area(
        fitness.workout_facts,
        ("sets", "reps", "volume_kg", "top_kg", "minutes", "km"),
        ("workout", "exercise"),
    ),
    "weight": Area(fitness.weigh_in_facts, ("kg", "body_fat_pct"), ()),
    "money": Area(
        finance.record_facts,
        ("spent_minor", "received_minor"),
        ("type", "category", "payee", "account", "note"),
    ),
    "habits": Area(
        habits.log_facts,
        ("done", "value"),
        ("habit", "status"),
        only_by={"value": "habit"},
    ),
    "tasks": Area(tasks.task_facts, ("done", "open"), ("task", "list", "status")),
    "focus": Area(focus.session_facts, ("focus_min",), ("item",)),
}

# Levels, not amounts: two weigh-ins in a day don't make 150 kg, so these
# are averaged per record and never summed.
LEVELS = {"kg", "body_fat_pct", "top_kg"}

AVERAGES_NOTE = (
    "average_per_logged_day divides by the days that had a value (how much "
    "on a day you logged); average_per_calendar_day divides by every day in "
    "the range. Say which one you use."
)


def _day(row: dict[str, Any]) -> date:
    return date.fromisoformat(str(row["day"]))


def _key(d: date, row: dict[str, Any], group_by: str) -> str:
    if group_by == "day":
        return d.isoformat()
    if group_by == "week":
        return (d - timedelta(days=d.weekday())).isoformat()
    if group_by == "month":
        return d.strftime("%Y-%m")
    if group_by == "weekday":
        return WEEKDAYS[d.weekday()]
    v = row.get(group_by)
    return "(none)" if v in (None, "") else str(v)


def _r(x: float) -> float:
    return round(x, 1)


def _stats(rows: Sequence[dict[str, Any]], metrics: Sequence[str]) -> dict[str, Any]:
    """Per metric: amounts summed with the days that had a known value (the
    denominator of their per-day average); levels as average, min and max
    per record; and how many rows the metric applied to but was unknown."""
    total: dict[str, float] = {}
    per_day: dict[str, float] = {}
    days_with_value: dict[str, int] = {}
    levels: dict[str, dict[str, float]] = {}
    unknown: dict[str, int] = {}
    for m in metrics:
        known = [r for r in rows if r.get(m) is not None]
        missing = sum(1 for r in rows if m in r and r[m] is None)
        if missing:
            unknown[m] = missing
        values = [float(r[m]) for r in known]
        if m in LEVELS:
            if values:
                levels[m] = {
                    "average": _r(sum(values) / len(values)),
                    "min": min(values),
                    "max": max(values),
                }
            continue
        total[m] = _r(sum(values))
        n = len({r["day"] for r in known})
        days_with_value[m] = n
        if n:
            per_day[m] = _r(total[m] / n)
    out: dict[str, Any] = {"sum": total}
    if per_day:
        out["average_per_logged_day"] = per_day
        out["days_with_value"] = days_with_value
    if levels:
        out["per_record"] = levels
    if unknown:
        out["unknown"] = unknown
    return out


def summarize(
    rows: list[dict[str, Any]],
    *,
    metrics: Sequence[str],
    group_by: str,
    first: date,
    last: date,
    contains: str | None = None,
    search: Sequence[str] = (),
    per_group_only: Sequence[str] = (),
    limit: int = RECORD_LIMIT,
) -> dict[str, Any]:
    if contains:
        needle = contains.casefold()
        rows = [
            r
            for r in rows
            if any(needle in str(r.get(f) or "").casefold() for f in search)
        ]
    # Metrics that only add up within one group stay out of the whole.
    whole = _stats(rows, [m for m in metrics if m not in per_group_only])
    span = (last - first).days + 1
    out: dict[str, Any] = {
        "first_day": first.isoformat(),
        "last_day": last.isoformat(),
        "days_in_range": span,
        "days_with_records": len({r["day"] for r in rows}),
        "records_matched": len(rows),
        "total": whole["sum"],
        # Two averages that answer different questions; the model mixed
        # them up when one was named "per day" and the other "per calendar
        # day" (seen 2026-10-31), so each name says its denominator.
        # Each metric's total over the days that had a known value for it
        # (``days_with_value``), never over days it was missing.
        "average_per_logged_day": whole.get("average_per_logged_day"),
        # The same total over every day in the range, logged or not.
        "average_per_calendar_day": {m: _r(v / span) for m, v in whole["sum"].items()}
        or None,
        "which_average": AVERAGES_NOTE,
    }
    for k in ("days_with_value", "per_record", "unknown"):
        if k in whole:
            out[k] = whole[k]
    if group_by == "none":
        newest = sorted(rows, key=lambda r: str(r["day"]), reverse=True)
        out["records"] = newest[:limit]
        out["truncated"] = len(rows) > limit
        return out
    groups: dict[str, list[dict[str, Any]]] = {}
    for r in rows:
        groups.setdefault(_key(_day(r), r, group_by), []).append(r)
    # How many calendar days of the range fall in each time group (3
    # Mondays, 7 days of a week), so a group with no records still counts.
    calendar: dict[str, int] = {}
    if group_by in TIME_KEYS:
        d = first
        while d <= last:
            k = _key(d, {}, group_by)
            calendar[k] = calendar.get(k, 0) + 1
            d += timedelta(days=1)
    listed: list[dict[str, Any]] = []
    for k, g in groups.items():
        st = _stats(g, metrics)
        group: dict[str, Any] = {
            "key": k,
            "count": len(g),
            "days": len({r["day"] for r in g}),
        } | st
        if k in calendar:
            group["calendar_days"] = calendar[k]
            group["average_per_calendar_day"] = {
                m: _r(v / calendar[k]) for m, v in st["sum"].items()
            }
        listed.append(group)
    if group_by == "weekday":
        listed.sort(key=lambda g: WEEKDAYS.index(g["key"]))
    elif group_by in TIME_KEYS:
        listed.sort(key=lambda g: g["key"])
    else:
        lead = next((m for m in metrics if m not in LEVELS), None)
        listed.sort(
            key=lambda g: (-(g["sum"].get(lead, 0) if lead else g["count"]), g["key"])
        )
    out["groups"] = listed[:GROUP_LIMIT]
    out["truncated"] = len(listed) > GROUP_LIMIT
    return out


# Parts of an answer that hold counts per metric, not amounts.
_COUNTS = {"unknown", "days_with_value", "pct_change"}


def _money(value: Any, ctx: Ctx, *, amounts: bool = True) -> Any:
    """Every ``x_minor`` amount, anywhere in the answer, as ``x`` money text;
    counts keyed by a money metric keep their numbers."""
    if isinstance(value, dict):
        out: dict[str, Any] = {}
        for k, v in value.items():
            name = k[: -len("_minor")] if k.endswith("_minor") else k
            if k.endswith("_minor") and amounts and isinstance(v, (int, float)):
                out[name] = money(v, ctx.currency)
            else:
                out[name] = _money(v, ctx, amounts=amounts and k not in _COUNTS)
        return out
    if isinstance(value, list):
        return [_money(v, ctx, amounts=amounts) for v in value]
    return value


def query(
    ctx: Ctx,
    *,
    area: str,
    first: date,
    last: date,
    group_by: str,
    contains: str | None,
) -> dict[str, Any]:
    a = AREAS.get(area)
    if a is None:
        return {"error": "unknown_area", "areas": sorted(AREAS)}
    if last < first:
        first, last = last, first
    if (last - first).days + 1 > MAX_DAYS:
        return {"error": "at_most_366_days", "first_day": first.isoformat()}
    if group_by not in ("none", *TIME_KEYS, *a.fields):
        return {
            "error": "cannot_group_by_that",
            "group_by_one_of": ["none", *TIME_KEYS, *a.fields],
        }
    metrics = [m for m in a.metrics if a.only_by.get(m, group_by) == group_by]
    out = summarize(
        a.rows(ctx, first, last),
        metrics=metrics,
        group_by=group_by,
        first=first,
        last=last,
        contains=contains,
        search=a.fields,
        per_group_only=list(a.only_by),
    )
    answer: dict[str, Any] = _money(out | {"area": area}, ctx)
    return answer


# ---------------------------------------------------------------- compare


def periods(today: date, period: str, days: int) -> tuple[date, date, date, date]:
    """This period (up to today) and the one before it: the week from
    Monday, the month from the 1st, or the last ``days`` days."""
    if period == "week":
        first = today - timedelta(days=today.weekday())
        return first, today, first - timedelta(days=7), first - timedelta(days=1)
    if period == "month":
        first = today.replace(day=1)
        prev_last = first - timedelta(days=1)
        return first, today, prev_last.replace(day=1), prev_last
    first = today - timedelta(days=days - 1)
    return first, today, first - timedelta(days=days), first - timedelta(days=1)


def _pct(now: float, before: float) -> float | None:
    return _r((now - before) / abs(before) * 100) if before else None


def compare_summaries(this: dict[str, Any], prev: dict[str, Any]) -> dict[str, Any]:
    """Each metric this period against the one before, all worked out here.
    Amounts compare per calendar day, so a week four days old is fair to a
    whole one; levels (weight) compare their average per record."""
    this_avg = dict(this.get("average_per_calendar_day") or {})
    prev_avg = dict(prev.get("average_per_calendar_day") or {})
    for k, v in (this.get("per_record") or {}).items():
        this_avg[k] = v["average"]
    for k, v in (prev.get("per_record") or {}).items():
        prev_avg[k] = v["average"]
    keys = [k for k in this_avg if k in prev_avg]
    return {
        "this_period": {k: this_avg[k] for k in this_avg},
        "previous_period": {k: prev_avg[k] for k in prev_avg},
        "delta": {k: _r(this_avg[k] - prev_avg[k]) for k in keys},
        "pct_change": {k: _pct(this_avg[k], prev_avg[k]) for k in keys},
        "compared_as": "average per calendar day for amounts; average per "
        "record for levels",
    }


def compare(
    ctx: Ctx,
    *,
    area: str,
    period: str,
    days: int,
    contains: str | None,
) -> dict[str, Any]:
    """``compare_periods``: this week, month or N days against the one
    before, and for meals against the daily target."""
    a = AREAS.get(area)
    if a is None:
        return {"error": "unknown_area", "areas": sorted(AREAS)}
    first, last, pfirst, plast = periods(ctx.today, period, days)
    metrics = [m for m in a.metrics if m not in a.only_by]

    def one(lo: date, hi: date) -> dict[str, Any]:
        return summarize(
            a.rows(ctx, lo, hi),
            metrics=metrics,
            group_by="none",
            first=lo,
            last=hi,
            contains=contains,
            search=a.fields,
            limit=0,
        )

    this, prev = one(first, last), one(pfirst, plast)
    out: dict[str, Any] = {
        "area": area,
        "this": {"first_day": first.isoformat(), "last_day": last.isoformat(),
                 "days": this["days_in_range"], "days_with_records": this["days_with_records"],
                 "total": this["total"]},
        "previous": {"first_day": pfirst.isoformat(), "last_day": plast.isoformat(),
                     "days": prev["days_in_range"], "days_with_records": prev["days_with_records"],
                     "total": prev["total"]},
    } | compare_summaries(this, prev)  # fmt: skip
    if area == "meals":
        target = fitness.nutrition_today(ctx).get("target") or {}
        logged = this.get("average_per_logged_day") or {}
        vs = {
            k: {
                "average_per_logged_day": logged[k],
                "daily_target": target[k],
                "delta": _r(logged[k] - float(target[k])),
            }
            for k in ("kcal", "protein", "carbs", "fat")
            if k in logged and k in target
        }
        if vs:
            out["this_period_vs_daily_target"] = vs
    answer: dict[str, Any] = _money(out, ctx)
    return answer
