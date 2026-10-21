"""The habits module's stats contributor (ADR-0014), ported from
``shared/prototype/habits/index.ts``.

Windows are business-day windows; ``overall_stats`` is anchored on today, so a
window ending ``n`` days ago is ``offset=n``.
"""

from datetime import date

from app.modules.habits import logic as L
from app.modules.habits.views import World, load_world
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


def _overall(ctx: Ctx, w: World, window: Window) -> L.OverallStats:
    return L.overall_stats(
        w.habit_list(),
        w.idx,
        window.days,
        ctx.today,
        offset=(ctx.today - window.last).days,
        zone=ctx.clock.zone,
    )


def _denominator(ctx: Ctx, w: World, window: Window) -> int:
    total = 0
    for v in w.active_views():
        s = L.habit_stats(v, w.idx, window.first, window.last, ctx.today)
        total += s.scheduled - s.skipped
    return total


def _pct(x: float) -> str:
    return f"{L.js_round(x * 100)}%"


def _routine_rate(w: World, window: Window) -> float | None:
    """Completed runs / scheduled routine days across active routines, with
    the window's last day standing in for today (runs after it ignored)."""
    runs = [v for v in w.run_views.values() if v.day <= window.last]
    done = scheduled = 0
    for r in w.routines:
        if r.status != "active":
            continue
        s = L.routine_stats(w.routine_views[r.id], runs, window.days, window.last)
        done += s.completed
        scheduled += s.scheduled_days
    return done / scheduled if scheduled else None


class HabitsContributor:
    key: ModuleKey = "habits"
    label = "Habits"
    href = "/habits"

    def area_rate(self, ctx: Ctx, window: Window) -> float | None:
        w = load_world(ctx)
        if _denominator(ctx, w, window) == 0:
            return None
        return _overall(ctx, w, window).rate

    def day_progress(self, ctx: Ctx, days: list[date]) -> dict[date, DayProgress]:
        """``useTodayProgress`` for each day: due habits not skipped, and how
        many of those are done."""
        w = load_world(ctx)
        out: dict[date, DayProgress] = {}
        for day in days:
            due = done = 0
            for v in w.habit_list():
                if not L.is_due(v, day):
                    continue
                lg = w.idx.get((v.id, day))
                if lg is not None and lg.status == "skipped":
                    continue
                due += 1
                if lg is not None and lg.status == "done":
                    done += 1
            out[day] = DayProgress(due=due, done=done)
        return out

    def metrics(self, ctx: Ctx, window: Window, prev: Window) -> list[Metric]:
        w = load_world(ctx)
        cur = _overall(ctx, w, window)
        before = _overall(ctx, w, prev)
        tops = sorted(
            ((v, L.streaks(v, w.idx, ctx.today).current) for v in w.active_views()),
            key=lambda x: -x[1],
        )
        top = tops[0] if tops else None
        return [
            Metric(
                key="habits.rate",
                label="Habit completion",
                value=_pct(cur.rate),
                number=cur.rate,
                delta=L.js_round((cur.rate - before.rate) * 100),
                good_when="up",
            ),
            Metric(
                key="habits.streak",
                label=f"Top streak · {top[0].name}" if top else "Top streak",
                value=f"{top[1] if top else 0}-day",
                number=top[1] if top else 0,
            ),
            Metric(
                key="habits.perfect",
                label="Perfect days",
                value=str(cur.perfect),
                number=cur.perfect,
                delta=cur.perfect - before.perfect,
                good_when="up",
            ),
            Metric(
                key="habits.time",
                label="Time invested",
                value=L.fmt_minutes(cur.minutes),
                number=cur.minutes,
                delta=L.js_round((cur.minutes - before.minutes) / 60),
                good_when="up",
            ),
            Metric(
                key="habits.skip",
                label="Skip rate",
                value=_pct(cur.skip_rate),
                number=cur.skip_rate,
                delta=L.js_round((cur.skip_rate - before.skip_rate) * 100),
                good_when="down",
            ),
        ]

    def calendar(self, ctx: Ctx, window: Window) -> list[CalendarItem]:
        w = load_world(ctx)
        out: list[CalendarItem] = []
        for day in L.days_between(window.first, window.last):
            for r in w.routines:
                rv = w.routine_views[r.id]
                if r.status != "active" or day < rv.created:
                    continue
                slot = L.slot_for(rv.schedule, day)
                if slot is None:
                    continue
                out.append(
                    CalendarItem(
                        id=f"routine-{r.id}-{day.isoformat()}",
                        day=day,
                        time=slot.time,
                        title=f"{r.icon} {r.name}",
                        module="habits",
                        done=any(
                            x.routine_id == r.id
                            and x.day == day
                            and x.state == "completed"
                            for x in w.runs
                        ),
                        href=f"/habits/routines/{r.id}",
                    )
                )
            for h in w.habits:
                v = w.views[h.id]
                if not L.is_due(v, day):
                    continue
                hslot = L.slot_for(v.schedule, day)
                lg = w.idx.get((v.id, day))
                out.append(
                    CalendarItem(
                        id=f"habit-{h.id}-{day.isoformat()}",
                        day=day,
                        time=hslot.time if hslot else None,
                        title=f"{h.icon} {h.name}",
                        module="habits",
                        done=lg is not None and lg.status == "done",
                        href=f"/habits/{h.id}",
                    )
                )
        return out

    def misses(self, ctx: Ctx, window: Window) -> list[Miss]:
        w = load_world(ctx)
        today = ctx.today
        out: list[Miss] = []
        for day in L.days_between(window.first, window.last):
            for h in w.habits:
                if L.cell_for(w.views[h.id], day, w.idx, today) == "missed":
                    out.append(
                        Miss(
                            id=f"miss-{h.id}-{day.isoformat()}",
                            day=day,
                            title=f"Missed: {h.name}",
                            module="habits",
                            href=f"/habits/{h.id}",
                            kind="missed",
                        )
                    )
        names = {r.id: r.name for r in w.routines}
        for run in w.runs:
            if not window.first <= run.day <= window.last:
                continue
            if L.run_state(w.run_views[run.id], today) != "abandoned":
                continue
            out.append(
                Miss(
                    id=f"abandon-{run.id}",
                    day=run.day,
                    title=(
                        f"{names.get(run.routine_id, 'Routine')} abandoned at "
                        f"{run.current}/{len(run.steps)}"
                    ),
                    module="habits",
                    href=f"/habits/routines/{run.routine_id}",
                    kind="abandoned",
                )
            )
        return out

    def achievements(self, ctx: Ctx) -> list[Achievement]:
        """One achievement per streak milestone: earned on the first day any
        active habit's streak reached it; otherwise progress toward it from
        the best streak so far."""
        w = load_world(ctx)
        today = ctx.today
        reached: dict[int, tuple[date, str, str]] = {}
        best = 0
        best_name = ""
        for h in w.habits:
            v = w.views[h.id]
            if v.status == "archived":
                continue
            run = 0
            for day in L.days_between(v.created, today):
                c = L.cell_for(v, day, w.idx, today)
                if c in ("done", "partial"):
                    run += 1
                    if run > best:
                        best, best_name = run, h.name
                    for m in L.STREAK_MILESTONES:
                        if run == m and (m not in reached or day < reached[m][0]):
                            reached[m] = (day, h.name, str(h.id))
                elif c == "missed":
                    run = 0
        out: list[Achievement] = []
        for m in L.STREAK_MILESTONES:
            got = reached.get(m)
            out.append(
                Achievement(
                    id=f"habits-streak-{m}",
                    type="streak",
                    title=f"{m}-day streak",
                    value=f"{m}-day",
                    detail=got[1] if got else best_name,
                    day=got[0] if got else None,
                    href=f"/habits/{got[2]}" if got else "/habits",
                    progress_pct=100.0 if got else min(100.0, best / m * 100),
                    progress_text=f"{m}/{m}" if got else f"{min(best, m)}/{m}",
                    earned=got is not None,
                )
            )
        return out

    def facets(self, ctx: Ctx, window: Window, prev: Window) -> list[Facet]:
        w = load_world(ctx)
        cur = _overall(ctx, w, window)
        before = _overall(ctx, w, prev)
        r_cur = _routine_rate(w, window)
        r_prev = _routine_rate(w, prev)
        return [
            Facet(
                key="habits",
                label="Habits",
                module="habits",
                value=cur.rate,
                prev=before.rate,
                off=not w.active_views(),
                metric_keys=("habits.rate", "habits.streak", "habits.perfect"),
                href="/habits",
            ),
            Facet(
                key="routines",
                label="Routines",
                module="habits",
                value=r_cur or 0.0,
                prev=r_prev or 0.0,
                off=r_cur is None,
                metric_keys=(),
                href="/habits/routines",
            ),
        ]


contributor = HabitsContributor()
