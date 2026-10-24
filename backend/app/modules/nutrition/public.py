"""Cross-module contract of the nutrition module."""

from app.modules.fitness import repo
from app.shared.context import Ctx


def items_due_today(ctx: Ctx) -> list[tuple[str, bool]]:
    """Today's nutrition ring items by name, as (item, done)."""
    from app.modules.nutrition.stats import items_due

    return items_due(repo.load_state(ctx), ctx.today)
