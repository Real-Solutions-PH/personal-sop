"""The nutrition stats contributor (ADR-0014, ADR-0024): a port of the module
contract in ``shared/prototype/nutrition/index.ts`` plus the nutrition facet
of ``dash/facets.ts``.

Meals and macro targets are stored by the fitness module, so this reads its
state; only the counting is nutrition's own.
"""

from datetime import date

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

KEY: ModuleKey = "nutrition"


def _offset(ctx: Ctx, window: Window) -> int:
    """How many days before today the window ends."""
    return (ctx.today - window.last).days


def _pct(x: float) -> str:
    return f"{C.js_round(x * 100)}%"


def items_due(s: C.FitState, day: date) -> list[tuple[str, bool]]:
    """What nutrition counts as due on ``day``, as (item, done): the protein
    target, when a target applies."""
    if C.target_for(s, day) is None:
        return []
    return [("protein target", C.nutrition_day(s, day).protein_hit)]


class NutritionContributor:
    key: ModuleKey = KEY
    label = "Nutrition"
    href = "/nutrition"

    def area_rate(self, ctx: Ctx, window: Window) -> float | None:
        s = repo.load_state(ctx)
        return C.nutrition_area_rate(s, window.days, ctx.today, _offset(ctx, window))

    def day_progress(self, ctx: Ctx, days: list[date]) -> dict[date, DayProgress]:
        s = repo.load_state(ctx)
        out: dict[date, DayProgress] = {}
        for day in days:
            items = items_due(s, day)
            out[day] = DayProgress(
                due=len(items), done=sum(1 for _, done in items if done)
            )
        return out

    def metrics(self, ctx: Ctx, window: Window, prev: Window) -> list[Metric]:
        """Calories on target and protein hit rate over the logged days, the
        average intake of those days, and how many of the window's days had
        at least one meal."""
        s = repo.load_state(ctx)
        today = ctx.today
        a = C.adherence(s, window.days, today, _offset(ctx, window))
        b = C.adherence(s, prev.days, today, _offset(ctx, prev))

        def avg_kcal(x: C.Adherence) -> float | None:
            eaten = [d.totals.kcal for d in x.days if d.meals > 0]
            return sum(eaten) / len(eaten) if eaten else None

        def logged(x: C.Adherence) -> int:
            return sum(1 for d in x.days if d.meals > 0)

        kcal, kcal_prev = avg_kcal(a), avg_kcal(b)
        return [
            Metric("calories", "Calories on target", _pct(a.calorie), a.calorie, None, "up"),
            Metric("protein", "Protein hit rate", _pct(a.protein), a.protein, None, "up"),
            Metric(
                "kcal", "Average calories",
                f"{C.js_round(kcal):,} kcal" if kcal is not None else "—",
                kcal,
                C.js_round(kcal - kcal_prev)
                if kcal is not None and kcal_prev is not None else None,
                None, shareable=False,
            ),
            Metric(
                "logged", "Days logged", str(logged(a)), logged(a),
                logged(a) - logged(b), "up",
            ),
        ]  # fmt: skip

    def calendar(self, ctx: Ctx, window: Window) -> list[CalendarItem]:
        return []

    def misses(self, ctx: Ctx, window: Window) -> list[Miss]:
        """Days more than 10% over the calorie target."""
        s = repo.load_state(ctx)
        today = ctx.today
        out: list[Miss] = []
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
                    id=f"nut-over-{d.day.isoformat()}",
                    day=d.day,
                    title=f"Over calories by {pct}%",
                    module=KEY,
                    href=f"/nutrition?day={d.day.isoformat()}",
                    kind="calories",
                )
            )
        return sorted(out, key=lambda m: m.day, reverse=True)

    def achievements(self, ctx: Ctx) -> list[Achievement]:
        return []

    def facets(self, ctx: Ctx, window: Window, prev: Window) -> list[Facet]:
        s = repo.load_state(ctx)
        today = ctx.today
        off = not profile_public.module_settings(ctx)[KEY].enabled

        def rate(w: Window) -> float:
            return C.nutrition_area_rate(s, w.days, today, _offset(ctx, w)) or 0.0

        return [
            Facet(
                key="nutrition",
                label="Nutrition",
                module=KEY,
                value=rate(window),
                prev=rate(prev),
                off=off,
                metric_keys=("calories", "protein", "kcal", "logged"),
                href="/nutrition",
            )
        ]


contributor = NutritionContributor()
