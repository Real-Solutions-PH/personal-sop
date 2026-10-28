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
    ) -> None:
        self.rows, self.metrics, self.fields = rows, metrics, fields


# The numbers each area sums, and the text fields it can be grouped by or
# searched in. Money is in minor units (``_minor``) until the very end.
AREAS: dict[str, Area] = {
    "meals": Area(
        fitness.meal_item_facts,
        ("kcal", "protein", "carbs", "fat", "fiber", "sat_fat", "sugar", "sodium"),
        ("meal", "food"),
    ),
    "workouts": Area(
        fitness.workout_facts,
        ("sets", "reps", "volume_kg", "top_kg", "minutes"),
        ("workout", "exercise"),
    ),
    "weight": Area(fitness.weigh_in_facts, ("kg", "body_fat_pct"), ()),
    "money": Area(
        finance.record_facts,
        ("spent_minor", "received_minor"),
        ("type", "category", "payee", "account", "note"),
    ),
    "habits": Area(habits.log_facts, ("done", "value"), ("habit", "status")),
    "tasks": Area(tasks.task_facts, ("done", "open"), ("task", "list", "status")),
    "focus": Area(focus.session_facts, ("focus_min",), ("item",)),
}

# Averages of these are per record, not per day: two weigh-ins in a day
# don't make 125 kg.
LEVELS = {"kg", "body_fat_pct", "top_kg"}


def _key(row: dict[str, Any], group_by: str) -> str:
    d = date.fromisoformat(str(row["day"]))
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


def _sums(rows: Sequence[dict[str, Any]], metrics: Sequence[str]) -> dict[str, float]:
    return {
        m: _r(sum(float(r[m]) for r in rows if r.get(m) is not None)) for m in metrics
    }


def summarize(
    rows: list[dict[str, Any]],
    *,
    metrics: Sequence[str],
    group_by: str,
    first: date,
    last: date,
    contains: str | None = None,
    limit: int = RECORD_LIMIT,
) -> dict[str, Any]:
    if contains:
        needle = contains.casefold()
        rows = [
            r
            for r in rows
            if any(
                isinstance(v, str) and needle in v.casefold()
                for k, v in r.items()
                if k != "day"
            )
        ]
    days = {r["day"] for r in rows}
    total = _sums(rows, metrics)
    out: dict[str, Any] = {
        "first_day": first.isoformat(),
        "last_day": last.isoformat(),
        "days_in_range": (last - first).days + 1,
        "days_with_records": len(days),
        "records_matched": len(rows),
        "total": {m: v for m, v in total.items() if m not in LEVELS},
        "average_per_day_with_records": (
            {m: _r(v / len(days)) for m, v in total.items() if m not in LEVELS}
            if days
            else None
        ),
    }
    levels = [m for m in metrics if m in LEVELS]
    if levels:
        seen = {m: [float(r[m]) for r in rows if r.get(m) is not None] for m in levels}
        out["per_record"] = {
            m: {"average": _r(sum(v) / len(v)), "min": min(v), "max": max(v)}
            for m, v in seen.items()
            if v
        }
    unknown = {m: sum(1 for r in rows if r.get(m) is None) for m in metrics}
    if any(unknown.values()):
        out["unknown"] = {m: n for m, n in unknown.items() if n}
    if group_by == "none":
        newest = sorted(rows, key=lambda r: str(r["day"]), reverse=True)
        out["records"] = newest[:limit]
        out["truncated"] = len(rows) > limit
        return out
    groups: dict[str, list[dict[str, Any]]] = {}
    for r in rows:
        groups.setdefault(_key(r, group_by), []).append(r)
    listed: list[dict[str, Any]] = [
        {
            "key": k,
            "count": len(g),
            "days": len({r["day"] for r in g}),
            "sum": _sums(g, metrics),
        }
        for k, g in groups.items()
    ]
    if group_by == "weekday":
        listed.sort(key=lambda g: WEEKDAYS.index(g["key"]))
    elif group_by in TIME_KEYS:
        listed.sort(key=lambda g: g["key"])
    else:
        lead = metrics[0]
        listed.sort(key=lambda g: (-g["sum"][lead], g["key"]))
    out["groups"] = listed[:GROUP_LIMIT]
    out["truncated"] = len(listed) > GROUP_LIMIT
    return out


def _money(value: Any, ctx: Ctx) -> Any:
    """Every ``x_minor`` amount, anywhere in the answer, as ``x`` money text."""
    if isinstance(value, dict):
        return {
            (k[: -len("_minor")] if k.endswith("_minor") else k): (
                money(v, ctx.currency)
                if k.endswith("_minor") and v is not None
                else _money(v, ctx)
            )
            for k, v in value.items()
        }
    if isinstance(value, list):
        return [_money(v, ctx) for v in value]
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
    out = summarize(
        a.rows(ctx, first, last),
        metrics=a.metrics,
        group_by=group_by,
        first=first,
        last=last,
        contains=contains,
    )
    answer: dict[str, Any] = _money(out | {"area": area}, ctx)
    return answer
