"""What is true for the user today, compact enough to put in front of the model.

The companion's model only sees what this module hands it: the snapshot in its
system prompt and the facts each block tool returns. The render blocks (plan,
coach, insights) draw from the user's records on the device, so a tool that
shows one also returns the same facts here; without them the model would
describe a card it cannot see, and invent it.

Every section is best effort: a module that cannot answer leaves its key out,
and the prompt tells the model that a missing fact is unknown, not zero.
"""

from typing import Any

from app.modules.fitness import public as fitness
from app.modules.focus import public as focus
from app.modules.habits import public as habits
from app.modules.nutrition import public as nutrition
from app.modules.stats import public as stats
from app.modules.tasks import public as tasks
from app.shared.context import Ctx

PLAN_ITEMS = 7  # the plan card's own limit (``PlanBlock`` in companion/blocks.tsx)
OVERDUE_IN_PLAN = 2
DUE_IN_PLAN = 5
OPEN_TASKS_SCANNED = 200


def _pct(rate: float | None) -> int | None:
    return None if rate is None else round(rate * 100)


def scores(ctx: Ctx) -> dict[str, Any]:
    """Life Score, on-target streak and today's ring (``stats.overview``)."""
    try:
        o = stats.overview(ctx, days=30)
    except NotImplementedError:
        return {}
    week = stats.overview(ctx, days=7)
    return {
        # Today shows the 7-day score; the Stats screen defaults to 30 days.
        "life_score_7_days_shown_on_today": week.life_score,
        "life_score_30_days": o.life_score,
        "life_score_change_vs_previous_30_days": o.delta,
        "on_target_streak_days": o.streak,
        "best_streak_days": o.best_streak,
        # Today's ring counts every area's items (a habit, a task, a planned
        # workout or meal target), so it goes out split by area: a bare
        # "2 due" reads as two tasks.
        "today_ring_by_area": _ring(ctx),
        "area_rates_30_days_pct": {
            a.module: _pct(a.rate) for a in o.areas if a.enabled and a.rate is not None
        },
    }


def _ring(ctx: Ctx) -> dict[str, dict[str, int]]:
    per = stats.day_ring(ctx).per
    return {k: {"due": d, "done": min(n, d)} for k, (d, n) in per.items() if d}


def _habits_due(ctx: Ctx) -> list[dict[str, Any]]:
    today = ctx.today
    w = habits.load_world(ctx, since=today)
    out: list[dict[str, Any]] = []
    for h in w.habit_list():
        if not habits.logic.is_due(h, today):
            continue
        slot = habits.logic.slot_for(h.schedule, today)
        log = w.idx.get((h.id, today))
        out.append(
            {
                "habit": h.name,
                "time": (slot.time if slot else None) or None,
                "done": log is not None and log.status == "done",
            }
        )
    return out


def _tasks_due(ctx: Ctx) -> tuple[list[dict[str, Any]], list[dict[str, Any]], int]:
    today = ctx.today
    rows = tasks.list_open_tasks(ctx, order="due", limit=OPEN_TASKS_SCANNED)
    overdue = [t for t in rows if t.due_date is not None and t.due_date < today]
    due = [t for t in rows if t.due_date == today]

    def item(t: Any) -> dict[str, Any]:
        return {"task": t.title, "due": t.due_date.isoformat(), "time": t.due_time}

    return [item(t) for t in overdue], [item(t) for t in due], len(rows)


def plan(ctx: Ctx) -> list[dict[str, Any]]:
    """The plan card's items, in its order: habits due and not done, then up
    to two overdue tasks and today's tasks (five tasks at most), by time,
    seven at most. Mirrors ``PlanBlock`` so the text and the card agree."""
    hs = [
        {"what": h["habit"], "kind": "habit", "time": h["time"]}
        for h in _habits_due(ctx)
        if not h["done"]
    ]
    overdue, due, _ = _tasks_due(ctx)
    ts = [
        {"what": t["task"], "kind": "task", "time": t["time"], "due": t["due"]}
        for t in (overdue[:OVERDUE_IN_PLAN] + due)[:DUE_IN_PLAN]
    ]
    items = sorted(hs + ts, key=lambda x: x["time"] or "99")
    return items[:PLAN_ITEMS]


def snapshot(ctx: Ctx) -> dict[str, Any]:
    """The facts the companion may state without calling a tool."""
    cur = ctx.currency
    out: dict[str, Any] = {
        "date": ctx.today.isoformat(),
        "currency": f"{cur.code} ({cur.symbol})",
    }
    out.update(scores(ctx))
    hs = _habits_due(ctx)
    out["habits_due_today"] = hs
    # Named, so the model knows what is left: the ring's fitness count alone
    # read as "nothing due" whenever no habit or task was.
    out["fitness_due_today"] = [
        {"item": item, "done": done} for item, done in fitness.items_due_today(ctx)
    ]
    out["nutrition_due_today"] = [
        {"item": item, "done": done} for item, done in nutrition.items_due_today(ctx)
    ]
    overdue, due, open_total = _tasks_due(ctx)
    out["tasks_overdue"] = overdue[:5]
    out["tasks_overdue_count"] = len(overdue)
    out["tasks_due_today"] = due[:5]
    out["tasks_due_today_count"] = len(due)
    # Only the first OPEN_TASKS_SCANNED are read; past that the count is a floor.
    key = (
        "open_tasks_total" if open_total < OPEN_TASKS_SCANNED else "open_tasks_at_least"
    )
    out[key] = open_total
    # Today's food against the macro target, and the latest weigh-in, so
    # "what's my macro status?" is answered from the user's own data.
    out["nutrition_today"] = fitness.nutrition_today(ctx)
    # Focused time today against the goal, and the focus timer if it runs.
    out["focus_today"] = focus.today_line(ctx)
    # A workout on the Live bar: sets said now belong to it, not a new log.
    live = fitness.chat.active_workout(ctx)
    if live is not None:
        out["workout_in_progress"] = {"id": str(live.id), "name": live.name}
    return out
