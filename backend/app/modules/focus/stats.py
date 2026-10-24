"""The focus stats contributor (ADR-0014, ADR-0025), a port of the module
contract in ``shared/prototype/focus/index.ts``.

The goal is the daily focus target (``focus_settings.daily_goal_min``). A day
is due from the person's first counted session on, and is done when its
focused time reaches the goal. The area rate is the mean of each due day's
share of the goal (capped at 1); it is ``None`` (the area is left out of the
Life Score) before the first session and while the goal is off.
"""

from datetime import date, timedelta

from app.modules.focus import logic as L
from app.modules.focus import services as svc
from app.modules.profile import public as profile_public
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
from app.shared.context import Ctx
from app.shared.day import days_between

KEY: ModuleKey = "focus"
METRIC_KEYS = ("focused", "daily", "goalDays", "sessions", "pomodoros")
STREAK_MILESTONES = (3, 7, 30, 100)


def _due_days(ctx: Ctx, window: Window, first: date | None) -> list[date]:
    """The window's days the goal applies to: from the first session, up to
    today."""
    if first is None:
        return []
    lo = max(first, window.first)
    hi = min(window.last, ctx.today)
    return days_between(lo, hi) if lo <= hi else []


def area_rate_of(by_day: dict[date, int], days: list[date], goal: int) -> float | None:
    if goal <= 0 or not days:
        return None
    return sum(min(1.0, by_day.get(d, 0) / goal) for d in days) / len(days)


class FocusContributor:
    key: ModuleKey = KEY
    label = "Focus"
    href = "/focus"

    def area_rate(self, ctx: Ctx, window: Window) -> float | None:
        days = _due_days(ctx, window, svc.first_day(ctx))
        if not days:
            return None
        r = svc.focus_range(ctx, window.first, window.last)
        return area_rate_of(r.by_day, days, svc.goal_sec(ctx))

    def day_progress(self, ctx: Ctx, days: list[date]) -> dict[date, DayProgress]:
        goal = svc.goal_sec(ctx)
        first = svc.first_day(ctx)
        out = {d: DayProgress(due=0, done=0) for d in days}
        if goal <= 0 or first is None or not days:
            return out
        by_day = svc.focus_range(ctx, min(days), max(days)).by_day
        for d in days:
            if d >= first:
                out[d] = DayProgress(due=1, done=int(by_day.get(d, 0) >= goal))
        return out

    def metrics(self, ctx: Ctx, window: Window, prev: Window) -> list[Metric]:
        """Focused time, the average a day, days on goal, sessions and
        Pomodoros finished, each against the previous window."""
        goal = svc.goal_sec(ctx)
        first = svc.first_day(ctx)

        def read(w: Window) -> tuple[int, float | None, int, int, int]:
            r = svc.focus_range(ctx, w.first, w.last)
            total = sum(r.by_day.values())
            due = _due_days(ctx, w, first)
            avg = total / len(due) if due else None
            on_goal = sum(1 for d in due if goal > 0 and r.by_day.get(d, 0) >= goal)
            lo, hi = ctx.clock.window(w.first, w.last)
            kept = [
                (row, tl)
                for row, tl in r.sessions
                if lo <= row.started_at < hi and row.end_reason != "abandoned"
            ]
            sets = sum(L.sets_completed(tl, ctx.now) for _, tl in kept)
            return total, avg, on_goal, len(kept), sets

        t, avg, og, n, sets = read(window)
        pt, pavg, pog, pn, psets = read(prev)
        return [
            Metric("focused", "Focused time", L.fmt_hm(t), t / 60, (t - pt) / 60, "up"),
            Metric(
                "daily", "Average a day", L.fmt_hm(avg) if avg is not None else "—",
                avg / 60 if avg is not None else None,
                (avg - pavg) / 60 if avg is not None and pavg is not None else None,
                "up",
            ),
            Metric("goalDays", "Days on goal", str(og), og, og - pog, "up"),
            Metric("sessions", "Sessions", str(n), n, n - pn, "up"),
            Metric("pomodoros", "Pomodoros", str(sets), sets, sets - psets, "up"),
        ]  # fmt: skip

    def calendar(self, ctx: Ctx, window: Window) -> list[CalendarItem]:
        """One item per session per day it covers: its focused time there
        and what it was mostly spent on."""
        r = svc.focus_range(ctx, window.first, window.last)
        out: list[CalendarItem] = []
        for row, _ in r.sessions:
            if row.end_reason == "abandoned":
                continue
            spans = [f for f in r.spans if f.session_id == row.id]
            for d in days_between(window.first, window.last):
                lo, hi = ctx.clock.window(d, d)
                here = [
                    L.Focused(max(f.start, lo), min(f.end, hi), f.item, f.session_id)
                    for f in spans
                    if f.end > lo and f.start < hi
                ]
                total = sum(L.per_item(here).values())
                if total <= 0:
                    continue
                top = svc.item_totals(here)[0][0]
                start = min(f.start for f in here).astimezone(ctx.clock.zone)
                title = f"Focus {L.fmt_hm(total)}" + (
                    f" · {top.title}" if top and top.title else ""
                )
                out.append(
                    CalendarItem(
                        id=f"focus-{row.id}-{d.isoformat()}",
                        day=d,
                        time=start.strftime("%H:%M"),
                        title=title,
                        module=KEY,
                        done=True,
                        href=f"/focus/day?day={d.isoformat()}",
                    )
                )
        return out

    def misses(self, ctx: Ctx, window: Window) -> list[Miss]:
        """Due days before today that ended under the goal."""
        goal = svc.goal_sec(ctx)
        days = [d for d in _due_days(ctx, window, svc.first_day(ctx)) if d < ctx.today]
        if goal <= 0 or not days:
            return []
        by_day = svc.focus_range(ctx, days[0], days[-1]).by_day
        out = [
            Miss(
                id=f"focus-under-{d.isoformat()}",
                day=d,
                title=f"Focused {L.fmt_hm(by_day.get(d, 0))} of {L.fmt_hm(goal)}",
                module=KEY,
                href=f"/focus/day?day={d.isoformat()}",
                kind="goal",
            )
            for d in days
            if by_day.get(d, 0) < goal
        ]
        return sorted(out, key=lambda m: m.day, reverse=True)

    def achievements(self, ctx: Ctx) -> list[Achievement]:
        """The first session, and one per goal-streak milestone."""
        first = svc.first_day(ctx)
        out = [
            Achievement(
                id="focus-first",
                type="first",
                title="First focus session",
                value="1",
                detail="Focus",
                day=first,
                href="/focus",
                progress_pct=100.0 if first else 0.0,
                progress_text="1/1" if first else "0/1",
                earned=first is not None,
            )
        ]
        goal = svc.goal_sec(ctx)
        reached: dict[int, date] = {}
        best = 0
        if first is not None and goal > 0:
            today = ctx.today
            lo = max(first, today - timedelta(days=399))
            by_day = svc.focus_range(ctx, lo, today).by_day
            run = 0
            for d in days_between(lo, today):
                if by_day.get(d, 0) >= goal:
                    run += 1
                    best = max(best, run)
                    for m in STREAK_MILESTONES:
                        if run == m and m not in reached:
                            reached[m] = d
                elif d != today:
                    run = 0
        for m in STREAK_MILESTONES:
            got = reached.get(m)
            out.append(
                Achievement(
                    id=f"focus-streak-{m}",
                    type="streak",
                    title=f"{m}-day focus streak",
                    value=f"{m}-day",
                    detail="Days on your focus goal",
                    day=got,
                    href="/focus/stats",
                    progress_pct=100.0 if got else min(100.0, best / m * 100),
                    progress_text=f"{m}/{m}" if got else f"{min(best, m)}/{m}",
                    earned=got is not None,
                )
            )
        return out

    def facets(self, ctx: Ctx, window: Window, prev: Window) -> list[Facet]:
        off = not profile_public.module_settings(ctx)[KEY].enabled
        return [
            Facet(
                key="focus",
                label="Focus",
                module=KEY,
                value=self.area_rate(ctx, window) or 0.0,
                prev=self.area_rate(ctx, prev) or 0.0,
                off=off,
                metric_keys=METRIC_KEYS,
                href="/focus/stats",
            )
        ]


contributor = FocusContributor()
