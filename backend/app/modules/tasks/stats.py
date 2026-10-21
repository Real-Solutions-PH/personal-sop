"""The tasks module's stats contributor (ADR-0014), mirroring the prototype's
``shared/prototype/tasks/index.ts`` module contract."""

from datetime import date

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
from app.modules.tasks import logic, repo
from app.shared.context import Ctx


def _stats(ctx: Ctx, loaded: repo.Loaded, window: Window) -> logic.TaskStats:
    return logic.compute_stats(
        loaded.state, window.first, window.last, ctx.today, ctx.clock
    )


class TasksContributor:
    key: ModuleKey = "tasks"
    label = "Tasks"
    href = "/tasks"

    def area_rate(self, ctx: Ctx, window: Window) -> float | None:
        """The on-time rate, or 0.5 (neutral) when nothing with a due date was
        done in the window: the prototype never leaves the area unrated."""
        return logic.area_rate(_stats(ctx, repo.load_state(ctx), window))

    def day_progress(self, ctx: Ctx, days: list[date]) -> dict[date, DayProgress]:
        state = repo.load_state(ctx).state
        out: dict[date, DayProgress] = {}
        for d in days:
            p = logic.day_progress(state, d, ctx.clock)
            out[d] = DayProgress(due=p.due, done=p.done)
        return out

    def metrics(self, ctx: Ctx, window: Window, prev: Window) -> list[Metric]:
        loaded = repo.load_state(ctx)
        return logic.metrics(_stats(ctx, loaded, window), _stats(ctx, loaded, prev))

    def calendar(self, ctx: Ctx, window: Window) -> list[CalendarItem]:
        return logic.calendar(repo.load_state(ctx).state, window.first, window.last)

    def misses(self, ctx: Ctx, window: Window) -> list[Miss]:
        return logic.misses(
            repo.load_state(ctx).state, window.first, window.last, ctx.today, ctx.clock
        )

    def achievements(self, ctx: Ctx) -> list[Achievement]:
        # The prototype's tasks contract has none.
        del ctx
        return []

    def facets(self, ctx: Ctx, window: Window, prev: Window) -> list[Facet]:
        # Facets are composed by the stats module from the metrics above.
        del ctx, window, prev
        return []


contributor = TasksContributor()
