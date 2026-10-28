"""Cross-module contract of the focus module (ADR-0025): what Fern and the
other modules may call. Plain dicts out, so a tool result is JSON as is."""

import uuid
from datetime import date, timedelta
from typing import Any, Literal

from sqlmodel import col, func

from app.modules.focus import logic as L
from app.modules.focus import services as svc
from app.modules.focus.schema import ItemRef, StartIn
from app.shared import owned_repo
from app.shared.context import Ctx

Control = Literal["pause", "resume", "skip_break", "next", "switch", "extend"]


def _item_out(i: ItemRef | None) -> dict[str, Any] | None:
    return {"kind": i.kind, "id": str(i.id), "title": i.title} if i else None


def _session_out(ctx: Ctx, row: Any) -> dict[str, Any]:
    d = svc.detail(ctx, row)
    p = d.phase
    return {
        "id": str(d.id),
        "mode": d.mode,
        "lengths": f"{d.focus_min}/{d.short_break_min}/{d.long_break_min} x {d.sets_before_long}"
        if d.mode == "pomodoro"
        else None,
        "status": p.status,
        "phase": p.kind,
        "set": p.set_index + 1,
        "remaining": L.fmt_hm(p.remaining_sec) if p.remaining_sec is not None else None,
        "elapsed": L.fmt_hm(p.elapsed_sec),
        "working_on": _item_out(p.item),
        "focused": L.fmt_hm(d.focus_sec),
        "end_reason": d.end_reason,
    }


def summary(ctx: Ctx, *, days: int = 1) -> dict[str, Any]:
    """Focus over the last ``days`` business days (1: today): the total,
    against the daily goal, by item, the goal streak and what runs now."""
    last = ctx.today
    first = last - timedelta(days=days - 1)
    r = svc.focus_range(ctx, first, last)
    goal = svc.get_settings(ctx).daily_goal_min
    streak, best = svc.streaks(ctx)
    total = sum(r.by_day.values())
    out: dict[str, Any] = {
        "from": first.isoformat(),
        "to": last.isoformat(),
        "focused": L.fmt_hm(total),
        "focused_minutes": total // 60,
        "daily_goal": L.fmt_hm(goal * 60) if goal else "off",
        "by_item": [
            {"item": i.title if i else "Nothing picked", "kind": i.kind if i else None,
             "time": L.fmt_hm(s)}
            for i, s in svc.item_totals(r.spans)
        ][:10],
        "goal_streak_days": streak,
        "best_goal_streak_days": best,
    }  # fmt: skip
    if days == 1:
        out["goal_left"] = L.fmt_hm(max(0, goal * 60 - total)) if goal else None
    else:
        out["by_day"] = [
            {
                "day": d.isoformat(),
                "focused": L.fmt_hm(s),
                "on_goal": goal > 0 and s >= goal * 60,
            }
            for d, s in sorted(r.by_day.items())
        ]
    cur = svc.current_row(ctx)
    out["running"] = _session_out(ctx, cur) if cur is not None else None
    return out


def find_item(ctx: Ctx, name: str) -> ItemRef | None:
    """An open task or an active habit whose title contains ``name``
    (exact matches first, then the shortest title)."""
    from app.modules.habits.models import Habit
    from app.modules.tasks.models import Task

    text = name.strip()
    if not text:
        return None
    like = f"%{text}%"
    tasks = owned_repo.list_rows(
        ctx, Task, col(Task.title).ilike(like), col(Task.status) == "open",
        order_by=[func.length(Task.title)], limit=5,
    )  # fmt: skip
    habits = owned_repo.list_rows(
        ctx, Habit, col(Habit.name).ilike(like), col(Habit.status) == "active",
        order_by=[func.length(Habit.name)], limit=5,
    )  # fmt: skip
    found = [ItemRef(kind="task", id=t.id, title=t.title) for t in tasks] + [
        ItemRef(kind="habit", id=h.id, title=h.name) for h in habits
    ]
    if not found:
        return None
    exact = [f for f in found if (f.title or "").lower() == text.lower()]
    return (exact or sorted(found, key=lambda f: len(f.title or "")))[0]


def start(
    ctx: Ctx,
    *,
    mode: Literal["pomodoro", "stopwatch"] | None = None,
    preset: Literal["25-5", "50-10", "90-20"] | None = None,
    focus_min: int | None = None,
    item: str | None = None,
) -> dict[str, Any]:
    ref = find_item(ctx, item) if item else None
    if item and ref is None:
        return {"error": "item_not_found", "item": item}
    row = svc.start(
        ctx,
        body=StartIn(
            id=uuid.uuid4(), mode=mode, preset=preset, focus_min=focus_min, item=ref
        ),
    )
    return _session_out(ctx, row)


def control(
    ctx: Ctx, *, action: Control, item: str | None = None, minutes: int = 5
) -> dict[str, Any]:
    if svc.current_row(ctx) is None:
        return {"error": "no_focus_session_running"}
    if action == "switch":
        ref = find_item(ctx, item) if item else None
        if item and ref is None:
            return {"error": "item_not_found", "item": item}
        row = svc.switch(ctx, item=ref)
    elif action == "extend":
        row = svc.extend(ctx, sec=max(1, min(60, minutes)) * 60)
    else:
        row = {
            "pause": svc.pause,
            "resume": svc.resume,
            "skip_break": svc.skip_break,
            "next": svc.start_next,
        }[action](ctx)
    return _session_out(ctx, row)


def stop(ctx: Ctx, *, abandon: bool = False) -> dict[str, Any]:
    if svc.current_row(ctx) is None:
        return {"error": "no_focus_session_running"}
    return _session_out(ctx, svc.stop(ctx, abandon=abandon))


def today_line(ctx: Ctx) -> dict[str, Any]:
    """The few focus facts Fern may state without a tool call."""
    s = summary(ctx)
    return {k: s[k] for k in ("focused", "daily_goal", "goal_left", "running")}


def session_facts(ctx: Ctx, first: date, last: date) -> list[dict[str, Any]]:
    """Focus minutes per business day and item over ``[first, last]``,
    worked out as the Focus screen does: a stretch crossing the day
    boundary split at it, overlaps within an item counted once."""
    r = svc.focus_range(ctx, first, last)
    by_item: dict[Any, list[Any]] = {}
    for f in r.spans:
        key = (f.item.kind, f.item.id) if f.item else None
        by_item.setdefault(key, []).append(f)
    out = []
    for spans in by_item.values():
        title = spans[0].item.title if spans[0].item else None
        for day, sec in sorted(L.per_day(spans, ctx.clock, first, last).items()):
            if sec:
                out.append(
                    {
                        "day": day.isoformat(),
                        "item": title,
                        "focus_min": round(sec / 60, 1),
                    }
                )
    return sorted(out, key=lambda x: str(x["day"]))
