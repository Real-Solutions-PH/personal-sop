"""The fitness stats contributor (ADR-0014): a port of the module contract in
``shared/prototype/fitness/index.ts`` plus the fitness parts of the
dashboard's facets and achievements (``dash/facets.ts``, ``dash/hooks.ts``).

A window is turned into the prototype's ``(days, offset)`` pair relative to
the user's business today, so the numbers match what the device showed.
"""

from datetime import date, timedelta

from app.modules.fitness import calc as C
from app.modules.fitness import repo
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

KEY: ModuleKey = "fitness"


def _offset(ctx: Ctx, window: Window) -> int:
    """How many days before today the window ends."""
    return (ctx.today - window.last).days


def _pct(x: float) -> str:
    return f"{C.js_round(x * 100)}%"


class FitnessContributor:
    key: ModuleKey = KEY
    label = "Fitness"
    href = "/fitness"

    def area_rate(self, ctx: Ctx, window: Window) -> float | None:
        s = repo.load_state(ctx)
        return C.area_rate(s, window.days, ctx.today, ctx.now, _offset(ctx, window))

    def day_progress(self, ctx: Ctx, days: list[date]) -> dict[date, DayProgress]:
        """Per day: the weigh-in is always due; a workout is due while the
        week is under target (or was done that day); protein is due when a
        target applies. The week counts sessions up to that day, which on
        today is the prototype's ``useTodayProgress``."""
        s = repo.load_state(ctx)
        weighed = C.daily_weights(s)
        trained = [s.day(w.started_at) for w in C.finished(s)]
        out: dict[date, DayProgress] = {}
        for day in days:
            week = C.week_start(day)
            in_week = sum(1 for d in trained if week <= d <= day)
            trained_today = day in trained
            workout_due = trained_today or in_week < s.settings.weekly_target
            due, done = 1, 1 if day in weighed else 0
            if workout_due:
                due += 1
                done += 1 if trained_today else 0
            if C.target_for(s, day) is not None:
                due += 1
                done += 1 if C.nutrition_day(s, day).protein_hit else 0
            out[day] = DayProgress(due=due, done=done)
        return out

    def metrics(self, ctx: Ctx, window: Window, prev: Window) -> list[Metric]:
        s = repo.load_state(ctx)
        today, now, days = ctx.today, ctx.now, window.days
        cur = C.period_summary(s, days, today, now, -_offset(ctx, window))
        before = C.period_summary(s, prev.days, today, now, -_offset(ctx, prev))
        a = C.adherence(s, days, today, _offset(ctx, window))
        rate = C.weekly_rate(s, today)
        overload = C.overload_rate(s, max(28, days), today)
        return [
            Metric(
                "sessions", "Workouts", str(cur.sessions), cur.sessions,
                cur.sessions - before.sessions, "up",
            ),
            Metric("prs", "PRs", str(cur.prs), cur.prs, cur.prs - before.prs, "up"),
            Metric(
                "volume", "Volume lifted", C.fmt_volume(cur.volume), cur.volume,
                C.js_round((cur.volume - before.volume) / max(1, before.volume) * 100),
                "up",
            ),
            Metric("overload", "Progress rate", _pct(overload), overload, None, "up"),
            Metric("protein", "Protein hit rate", _pct(a.protein), a.protein, None, "up"),
            Metric("calories", "Calories on target", _pct(a.calorie), a.calorie, None, "up"),
            Metric(
                "weight",
                "Weight (7-day avg)",
                f"{C.to_fixed(rate.avg, 1)} kg" if rate else "—",
                rate.avg if rate else None,
                C.js_round(rate.kg * 100) / 100 if rate else None,
                "up" if s.settings.goal_direction == "bulk" else "down",
                shareable=False,
            ),
        ]  # fmt: skip

    def calendar(self, ctx: Ctx, window: Window) -> list[CalendarItem]:
        s = repo.load_state(ctx, meals=False)
        out: list[CalendarItem] = []
        for w in s.workouts:
            day = s.day(w.started_at)
            if not window.first <= day <= window.last:
                continue
            done = w.status == "finished"
            out.append(
                CalendarItem(
                    id=f"fit-{w.id}",
                    day=day,
                    time=w.started_at.astimezone(ctx.clock.zone).strftime("%H:%M"),
                    title=w.name if done else f"{w.name} (in progress)",
                    module=KEY,
                    done=done,
                    href=f"/fitness/workouts/{w.id}" if done else "/fitness/workout",
                )
            )
        return out

    def misses(self, ctx: Ctx, window: Window) -> list[Miss]:
        """Weeks under the session target, days more than 10% over the
        calorie target, and lifts with no strength gain in 3 weeks."""
        s = repo.load_state(ctx)
        today = ctx.today
        target = s.settings.weekly_target
        this_week = C.week_start(today)
        out: list[Miss] = []
        for w in C.sessions_by_week(s, 20, today):
            end = w.start + timedelta(days=6)
            if w.start < window.first or end > window.last or w.start >= this_week:
                continue
            miss = target - w.count
            if miss > 0:
                out.append(
                    Miss(
                        id=f"fit-miss-{w.start.isoformat()}",
                        day=end,
                        title=f"Missed {miss} gym session{'s' if miss > 1 else ''} "
                        f"({w.count}/{target})",
                        module=KEY,
                        href="/fitness/stats",
                        kind="sessions",
                    )
                )
        for d in C.nutrition_days(s, 90, today):
            if (
                d.day < window.first
                or d.day > window.last
                or d.day == today
                or not d.over
                or d.target is None
            ):
                continue
            pct = C.js_round((d.totals.kcal / d.target.kcal - 1) * 100)
            out.append(
                Miss(
                    id=f"fit-over-{d.day.isoformat()}",
                    day=d.day,
                    title=f"Over calories by {pct}%",
                    module=KEY,
                    href=f"/fitness/nutrition?day={d.day.isoformat()}",
                    kind="calories",
                )
            )
        if window.first <= today <= window.last:
            for e in s.exercises:
                if not e.archived and C.is_stalled(
                    s, C.exercise_history(s, e.id), today
                ):
                    out.append(
                        Miss(
                            id=f"fit-stall-{e.id}",
                            day=today,
                            title=f"Stalled: {e.name} (no strength gain in 3 wks)",
                            module=KEY,
                            href=f"/fitness/exercises/{e.id}",
                            kind="stalled",
                        )
                    )
        return sorted(out, key=lambda m: m.day, reverse=True)

    def achievements(self, ctx: Ctx) -> list[Achievement]:
        """PR milestones (30 and 90 days, as on the dashboard) and firsts:
        the first finished workout and the first PR."""
        s = repo.load_state(ctx, meals=False)
        today, now = ctx.today, ctx.now
        yesterday = today - timedelta(days=1)
        p30 = C.period_summary(s, 30, today, now).prs
        p90 = C.period_summary(s, 90, today, now).prs
        out: list[Achievement] = []

        def pr(aid: str, title: str, cur: int, mx: int, detail: str) -> None:
            unit = "PR" if mx == 1 else "PRs"
            out.append(
                Achievement(
                    id=aid,
                    type="pr",
                    title=title,
                    value=str(cur),
                    detail=detail,
                    day=yesterday if cur >= mx else None,
                    href="/fitness/stats",
                    progress_pct=max(0.0, min(1.0, cur / mx)),
                    progress_text=f"{min(cur, mx)} / {mx} {unit}",
                    earned=cur >= mx,
                )
            )

        pr("pr-30", "PR this month", p30, 1,
           f"{p30} new best lift{'' if p30 == 1 else 's'} in 30 days")  # fmt: skip
        pr("pr-90-5", "5 PRs in 90 days", p90, 5, f"{p90} new best lifts in 90 days")
        pr("pr-90-10", "10 PRs in 90 days", p90, 10, f"{p90} new best lifts in 90 days")

        done = C.finished(s)
        prs = C.all_prs(s)
        firsts: list[tuple[str, str, date | None, str, str]] = [
            (
                "first-workout",
                "First workout",
                s.day(done[0].started_at) if done else None,
                "Where the training log began",
                f"/fitness/workouts/{done[0].id}" if done else "/fitness",
            ),
            (
                "first-pr",
                "First PR",
                s.day(prs[0].at) if prs else None,
                "Your first new best lift",
                f"/fitness/workouts/{prs[0].workout_id}" if prs else "/fitness/stats",
            ),
        ]
        for aid, title, day, detail, href in firsts:
            out.append(
                Achievement(
                    id=aid,
                    type="first",
                    title=title,
                    value="1st",
                    detail=detail,
                    day=day,
                    href=href,
                    progress_pct=1.0 if day else 0.0,
                    progress_text=f"{1 if day else 0} / 1",
                    earned=day is not None,
                )
            )
        return out

    def facets(self, ctx: Ctx, window: Window, prev: Window) -> list[Facet]:
        s = repo.load_state(ctx)
        today, now = ctx.today, ctx.now
        off = not profile_public.module_settings(ctx)[KEY].enabled

        def nut(w: Window) -> float:
            a = C.adherence(s, w.days, today, _offset(ctx, w))
            return a.calorie if a.logged else 0

        def sessions(w: Window) -> float:
            return C.period_summary(
                s, w.days, today, now, -_offset(ctx, w)
            ).session_rate

        return [
            Facet(
                key="training",
                label="Training",
                module=KEY,
                value=sessions(window),
                prev=sessions(prev),
                off=off,
                metric_keys=("sessions", "prs", "volume", "overload"),
                href="/fitness?tab=train",
            ),
            Facet(
                key="nutrition",
                label="Nutrition",
                module=KEY,
                value=nut(window),
                prev=nut(prev),
                off=off,
                metric_keys=("calories", "protein", "weight"),
                href="/fitness?tab=eat",
            ),
        ]


contributor = FitnessContributor()
