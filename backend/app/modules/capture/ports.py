"""Every call capture and its AI tools make into another module.

Every read and write goes through the owning module's ``public.py``; this
file only adapts their results to the shapes capture works with.
"""

import re
import uuid
from datetime import date, datetime, timedelta
from typing import Any

from app.modules.capture.parse import (
    HabitRef,
    MealEstimate,
    RoutineRef,
    TaskRef,
    World,
)
from app.modules.finance import public as finance
from app.modules.fitness import public as fitness
from app.modules.habits import public as habits
from app.modules.stats import public as stats
from app.modules.tasks import public as tasks
from app.shared.context import Ctx

__all__ = ["finance", "fitness", "habits", "stats", "tasks"]

# Category slugs the "what was it for?" chips fall back to (prototype order).
EXTRA_CATS = ("electricity", "internet", "groceries", "gifts")
MAX_OPEN_TASKS = 1000


def _s(v: uuid.UUID | None) -> str | None:
    return str(v) if v is not None else None


def meal_estimate(ctx: Ctx, text: str) -> MealEstimate | None:
    d = fitness.estimate_meal_text(ctx, text)
    if not d.items:
        return None
    items = []
    for i in d.items:
        it: dict[str, Any] = {
            "name": i.name,
            "qty": i.qty,
            "unit": i.unit,
            "kcal": i.kcal,
            "protein": i.protein,
            "carbs": i.carbs,
            "fat": i.fat,
        }
        if i.assumption is not None:
            it["assumption"] = i.assumption
        items.append(it)
    return MealEstimate(items=items, confidence=d.confidence, follow_up=d.follow_up)


def _account_keys(accounts: list[Any]) -> dict[str, str]:
    """Map the parser's account words onto this user's accounts."""
    live = [a for a in accounts if not a.archived]

    def first(test: Any) -> str | None:
        return next((str(a.id) for a in live if test(a)), None)

    def named(word: str) -> Any:
        return lambda a: re.search(rf"\b{word}\b", a.name.lower()) is not None

    out = {
        "gcash": first(lambda a: "gcash" in a.name.lower().replace("-", "")),
        "maya": first(named("maya")),
        "bpicc": first(lambda a: a.type == "credit" and "bpi" in a.name.lower())
        or first(lambda a: a.type == "credit"),
        "bpi": first(lambda a: "bpi" in a.name.lower() and a.type != "credit"),
        "col": first(named("col")),
        "cash": first(lambda a: a.type == "cash"),
    }
    return {k: v for k, v in out.items() if v}


def build_world(ctx: Ctx, *, at: datetime | None = None) -> World:
    """The parser's snapshot of the user's data at capture time."""
    when = at or ctx.now
    habit_rows = habits.list_habits(ctx)
    routine_rows = habits.list_routines(ctx)
    task_rows = tasks.list_open_tasks(ctx, order="newest", limit=MAX_OPEN_TASKS)
    finance.default_account(ctx)  # seeds finance settings + categories
    accounts = finance.list_accounts(ctx)
    cats = finance.list_categories(ctx)
    by_id = {c.id: c for c in cats}
    slugs = {c.slug: str(c.id) for c in cats if c.slug}
    counts = finance.expense_category_counts(ctx, since=when - timedelta(days=30))
    ranked = [k for k, _ in sorted(counts.items(), key=lambda kv: -kv[1])]
    for slug in EXTRA_CATS:
        extra = slugs.get(slug)
        if extra and uuid.UUID(extra) not in ranked:
            ranked.append(uuid.UUID(extra))
    recent = [
        {"label": f"{by_id[c].icon} {by_id[c].name}", "value": str(c)}
        for c in ranked[:6]
        if c in by_id
    ]
    default = finance.default_account(ctx)
    return World(
        today=ctx.clock.day_of(when),
        currency=ctx.currency,
        habits=[
            HabitRef(str(h.id), h.name, h.type, h.target, h.status) for h in habit_rows
        ],
        tasks=[TaskRef(str(t.id), t.title) for t in task_rows],
        routines=[
            RoutineRef(str(r.id), r.name, r.icon, r.status) for r in routine_rows
        ],
        account_keys=_account_keys(accounts),
        category_slugs=slugs,
        default_account=_s(default.id) if default else None,
        latest_kg=fitness.latest_weight_kg(ctx),
        latest_kg_day=fitness.latest_weigh_in_day(ctx),
        recent_cats=recent,
        account_options=[
            {"label": a.name, "value": str(a.id)}
            for a in accounts
            if not a.archived and a.type != "investment"
        ],
        list_keys={k: str(v) for k, v in tasks.list_keys(ctx).items()},
        meal=lambda text: meal_estimate(ctx, text),
    )


# ---------------------------------------------------------------- reads


def speech_names(ctx: Ctx) -> tuple[list[str], list[str]]:
    """(habit, exercise and account names; food library names): the
    person's own words for speech to text to expect. Archived habits and
    accounts are left out."""
    exercises, foods = fitness.names_for_speech(ctx)
    names = [h.name for h in habits.list_habits(ctx) if h.status != "archived"]
    names += exercises
    names += [a.name for a in finance.list_accounts(ctx) if not a.archived]
    return names, foods


def habit_log_on(ctx: Ctx, habit_id: uuid.UUID, day: date) -> dict[str, Any] | None:
    """The live (habit, day) log before a capture writes it, so undo can put
    it back."""
    row = habits.get_log(ctx, habit_id=habit_id, day=day)
    if row is None:
        return None
    return {
        "log_id": str(row.id),
        "status": row.status,
        "value": row.value,
        "note": row.note,
        "source": row.source,
    }


def habit_streak(ctx: Ctx, habit_id: uuid.UUID) -> int:
    """The habit's current streak (the post-log "N-day streak" note)."""
    return habits.current_streak(ctx, habit_id=habit_id)


def duplicate_expense(
    ctx: Ctx, *, amount_minor: int, at: datetime
) -> tuple[datetime, str | None] | None:
    """An expense of the same amount within a day of ``at`` (IA J4 alt)."""
    return finance.find_duplicate_expense(ctx, amount_minor=amount_minor, at=at)


def budget_note(ctx: Ctx, category_id: str | None) -> str | None:
    """'₱400 left in Food this month' after an expense (prototype
    ``budgetNote``), in the user's currency."""
    if not category_id:
        return None
    from app.shared.currency import money

    hit = finance.budget_left(ctx, category_id=category_id)
    if hit is None:
        return None
    name, left = hit
    if left >= 0:
        return f"{money(left, ctx.currency)} left in {name} this month"
    return f"Over {name} budget by {money(-left, ctx.currency)}"


def macros_left_today(ctx: Ctx) -> tuple[float, float, float, float] | None:
    left = fitness.macros_left(ctx, day=ctx.today)
    if left is None:
        return None
    return left.kcal, left.protein, left.carbs, left.fat


def open_tasks_due_by(ctx: Ctx, day: date) -> int:
    return tasks.count_open_due_by(ctx, day=day)


def finished_workouts_since(ctx: Ctx, since: datetime) -> int:
    return fitness.count_finished_workouts_since(ctx, since=since)


# ---------------------------------------------------------------- writes


def delete_habit(ctx: Ctx, habit_id: uuid.UUID) -> None:
    """Undo of a habit a capture created."""
    habits.delete_habit(ctx, habit_id=habit_id)


def put_back_habit_log(
    ctx: Ctx, prior: dict[str, Any], habit_id: uuid.UUID, day: date
) -> None:
    """Undo of a capture that edited an existing (habit, day) log: write the
    prior values back through the public log call."""
    habits.log_habit(
        ctx,
        habit_id=habit_id,
        day=day,
        value=prior.get("value"),
        status=prior.get("status"),
        source=prior.get("source") or "tap",
        note=prior.get("note"),
    )


def log_workout(
    ctx: Ctx,
    *,
    name: str,
    day: date,
    exercises: list[tuple[str, list[tuple[int, float]]]],
    cardio: dict[str, object] | None,
    workout_id: uuid.UUID,
) -> uuid.UUID:
    """A finished workout on ``day`` ("swam 30 min yesterday" lands
    yesterday)."""
    w = fitness.log_workout_from_chat(
        ctx,
        fitness.WorkoutDraft(
            name=name,
            exercises=[
                fitness.ExerciseDraft(
                    exercise=ex,
                    sets=[fitness.SetDraft(reps=r, weight=kg) for r, kg in sets],
                )
                for ex, sets in exercises
            ],
            cardio=cardio,
            workout_id=workout_id,
            day=day,
        ),
    )
    return w.id


def next_day_of_month(today: date, dom: int) -> date:
    """The next date (today included) falling on day-of-month ``dom``,
    clamped to the month's last day."""
    import calendar

    y, m = today.year, today.month
    for _ in range(2):
        last = calendar.monthrange(y, m)[1]
        d = date(y, m, min(dom, last))
        if d >= today:
            return d
        y, m = (y + 1, 1) if m == 12 else (y, m + 1)
    return today


def start_statement_import(
    ctx: Ctx,
    *,
    account_id: uuid.UUID,
    file_name: str,
    file_type: str,
    media_id: uuid.UUID | None,
    import_id: uuid.UUID,
    rows: list[dict[str, Any]] | None,
) -> uuid.UUID:
    """Hand a statement to finance's import (finance owns the review)."""
    return finance.start_statement_import(
        ctx,
        account_id=account_id,
        file_name=file_name,
        file_type=file_type,
        media_id=media_id,
        import_id=import_id,
        rows=rows,
    )


# ---------------------------------------------------------------- Q&A reads
# The deterministic Q&A (prototype ``qa.ts``) computes over each module's own
# state with that module's ported calculations, all from its ``public.py``.


def finance_state(ctx: Ctx) -> Any:
    return finance.load_state(ctx)


def fitness_state(ctx: Ctx) -> Any:
    return fitness.load_state(ctx)


def habits_world(ctx: Ctx, since: date) -> Any:
    return habits.load_world(ctx, since=since)


def open_task_rows(ctx: Ctx) -> list[Any]:
    return tasks.list_open_tasks(ctx, order="due", limit=MAX_OPEN_TASKS)


def calc_modules() -> tuple[Any, Any, Any]:
    """(finance calc, fitness calc, habits logic)."""
    return finance.calc, fitness.calc, habits.logic


def library_items(
    ctx: Ctx, items: list[dict[str, Any]]
) -> tuple[list[dict[str, Any]], list[str]]:
    """Meal items with nutrition from the person's food library where a
    food matches (the library comes before any estimate)."""
    return fitness.food_library.apply_library(ctx, items)


def meal_item_problems(ctx: Ctx, items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """What is wrong with each estimated item (one the food library won't
    replace), as ``{"item": name, "problems": [...]}``; empty when none."""
    hits = fitness.food_library.library_hits(ctx, items)
    out = []
    for it, hit in zip(items, hits, strict=True):
        found = [] if hit else fitness.nutrient_check.estimate_problems(it)
        if found:
            out.append({"item": it.get("name"), "problems": found})
    return out


WARN_MAX = 280


def meal_missing_details(items: list[dict[str, Any]]) -> str | None:
    """The card warning for items saved without sugar or sodium (they count
    toward the daily limits): "No sugar or sodium estimate for Rice"."""
    gaps: dict[tuple[str, ...], list[str]] = {}
    for it in items:
        missing = fitness.nutrient_check.missing_details(it)
        if missing:
            gaps.setdefault(tuple(missing), []).append(str(it.get("name"))[:40])

    def names(ns: list[str]) -> str:
        return ", ".join(ns[:3]) + (f" and {len(ns) - 3} more" if len(ns) > 3 else "")

    text = "; ".join(
        f"No {' or '.join(m)} estimate for {names(ns)}" for m, ns in gaps.items()
    )
    # The card's warning column holds 280 characters.
    return text[:WARN_MAX] or None


def saved_meal_with(
    ctx: Ctx, label: str, day: date, items: list[dict[str, Any]]
) -> uuid.UUID | None:
    """A meal already saved with this label on this day that shares a food
    with ``items``: logging it again would count that food twice."""
    names = {str(i.get("name", "")).strip().casefold() for i in items} - {""}
    for m in fitness.recent_meals(ctx, days=(ctx.today - day).days + 2):
        if m.label != label or ctx.clock.day_of(m.eaten_at) != day:
            continue
        if names & {
            r.name.strip().casefold() for r in fitness.chat.meal_item_rows(ctx, m.id)
        }:
            return m.id
    return None
