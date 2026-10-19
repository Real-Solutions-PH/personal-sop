"""Every call capture and its AI tools make into another module.

The writes go through each module's ``public.py``. A handful of reads and
writes the contracts do not offer yet are made here, read-only where
possible, and each one is marked ``GAP``: the coordinating session can move
it behind the owning module's ``public.py`` without touching the rest of
capture. Nothing outside this file imports another module's internals.
"""

import re
import uuid
from datetime import date, datetime, timedelta
from typing import Any

from sqlmodel import col, select

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
from app.shared import owned_repo
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
    # GAP: habits/tasks/finance expose lookups by query only; the parser
    # scores every candidate the way the prototype does, so it reads the
    # candidate lists here (read-only).
    from app.modules.finance.models import Account, Category, FinRecord
    from app.modules.habits.models import Habit, Routine
    from app.modules.tasks import ops as task_ops
    from app.modules.tasks.models import Task

    when = at or ctx.now
    habit_rows = owned_repo.list_rows(
        ctx, Habit, order_by=[col(Habit.sort_order), col(Habit.created_at)]
    )
    routine_rows = owned_repo.list_rows(
        ctx, Routine, order_by=[col(Routine.created_at)]
    )
    task_rows = owned_repo.list_rows(
        ctx,
        Task,
        col(Task.status) == "open",
        order_by=[col(Task.created_at).desc()],
        limit=MAX_OPEN_TASKS,
    )
    finance.default_account(ctx)  # seeds finance settings + categories
    accounts = owned_repo.list_rows(ctx, Account, order_by=[col(Account.sort_order)])
    cats = owned_repo.list_rows(
        ctx, Category, col(Category.archived).is_(False), order_by=[col(Category.sort_order)]
    )
    by_id = {c.id: c for c in cats}
    slugs = {c.slug: str(c.id) for c in cats if c.slug}
    since = when - timedelta(days=30)
    counts: dict[uuid.UUID, int] = {}
    for cid in ctx.session.exec(
        select(FinRecord.category_id)
        .where(
            FinRecord.owner_id == ctx.user_id,
            FinRecord.tenant_id == ctx.tenant_id,
            col(FinRecord.deleted_at).is_(None),
            FinRecord.type == "expense",
            col(FinRecord.is_adjustment).is_(False),
            col(FinRecord.category_id).is_not(None),
            col(FinRecord.at) > since,
        )
        .order_by(col(FinRecord.at))
    ).all():
        if cid is not None:
            counts[cid] = counts.get(cid, 0) + 1
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
        recent_cats=recent,
        account_options=[
            {"label": a.name, "value": str(a.id)}
            for a in accounts
            if not a.archived and a.type != "investment"
        ],
        list_keys={k: str(v) for k, v in task_ops._list_keys(ctx).items()},
        meal=lambda text: meal_estimate(ctx, text),
    )


# ---------------------------------------------------------------- reads


def habit_log_on(ctx: Ctx, habit_id: uuid.UUID, day: date) -> dict[str, Any] | None:
    """The live (habit, day) log before a capture writes it, so undo can put
    it back. GAP: habits.public has no read of one log."""
    from app.modules.habits.models import HabitLog

    row = owned_repo.find_one(
        ctx, HabitLog, col(HabitLog.habit_id) == habit_id, col(HabitLog.day) == day
    )
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
    """GAP: the habit's current streak (the post-log "N-day streak" note)."""
    from app.modules.habits import logic as HL
    from app.modules.habits import views as HV

    w = HV.load_world(ctx, since=ctx.today - timedelta(days=400))
    v = w.views.get(habit_id)
    return HL.streaks(v, w.idx, ctx.today).current if v else 0


def duplicate_expense(
    ctx: Ctx, *, amount_minor: int, at: datetime
) -> tuple[datetime, str | None] | None:
    """An expense of the same amount within a day of ``at`` (IA J4 alt).
    GAP: finance.public has no record search."""
    from app.modules.finance.models import FinRecord

    row = ctx.session.exec(
        select(FinRecord.at, FinRecord.payee)
        .where(
            FinRecord.owner_id == ctx.user_id,
            FinRecord.tenant_id == ctx.tenant_id,
            col(FinRecord.deleted_at).is_(None),
            FinRecord.type == "expense",
            FinRecord.amount_minor == amount_minor,
            col(FinRecord.at) > at - timedelta(days=1),
            col(FinRecord.at) < at + timedelta(days=1),
        )
        .order_by(col(FinRecord.at))
        .limit(1)
    ).first()
    return (row[0], row[1]) if row else None


def budget_note(ctx: Ctx, category_id: str | None) -> str | None:
    """'P400 left in Food this month' after an expense (prototype
    ``budgetNote``). GAP: finance.public has no budget read."""
    if not category_id:
        return None
    from app.modules.finance import calc as FC
    from app.modules.finance import repo as FR

    from app.modules.capture.money import peso

    s = FR.load_state(ctx)
    cats = FC.cat_map(s)
    parent = cats[category_id].parent_id if category_id in cats else None
    b = next(
        (
            x
            for x in s.budgets
            if not x.archived
            and x.category_ids
            and (category_id in x.category_ids or (parent and parent in x.category_ids))
        ),
        None,
    )
    if b is None:
        return None
    v = FC.budget_view(s, b)
    left = v.limit - v.spent
    if left >= 0:
        return f"{peso(left)} left in {b.name} this month"
    return f"Over {b.name} budget by {peso(-left)}"


def macros_left_today(ctx: Ctx) -> tuple[float, float, float, float] | None:
    """GAP: fitness.public has no macros-left read."""
    from app.modules.fitness import calc as XC
    from app.modules.fitness import repo as XR

    left = XC.macros_left(XR.load_state(ctx), ctx.today)
    if left is None:
        return None
    return left.kcal, left.protein, left.carbs, left.fat


def open_tasks_due_by(ctx: Ctx, day: date) -> int:
    from app.modules.tasks.models import Task

    return owned_repo.count_rows(
        ctx,
        Task,
        col(Task.status) == "open",
        col(Task.due_date).is_not(None),
        col(Task.due_date) <= day,
    )


def finished_workouts_since(ctx: Ctx, since: datetime) -> int:
    from app.modules.fitness.models import Workout

    return owned_repo.count_rows(
        ctx,
        Workout,
        col(Workout.status) == "finished",
        col(Workout.started_at) > since,
    )


# ---------------------------------------------------------------- writes


def delete_habit(ctx: Ctx, habit_id: uuid.UUID) -> None:
    """Undo of a habit a capture created. GAP: habits.public has no delete."""
    from app.modules.habits import services as HS

    HS._delete_habit(ctx, habit_id)


def put_back_habit_log(ctx: Ctx, prior: dict[str, Any], habit_id: uuid.UUID, day: date) -> None:
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
    """A finished workout on ``day``. GAP: ``fitness.public.WorkoutDraft``
    has no day, so "swam 30 min yesterday" would land today; the fitness use
    case takes one."""
    from app.modules.fitness import services as XS

    w = XS.log_workout_from_chat(
        ctx,
        name=name,
        exercises=exercises,
        day=day,
        workout_id=workout_id,
        cardio=cardio,
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
    """Hand a statement to finance's import (finance owns the review).
    GAP: finance.public has no import entry; these two use cases commit."""
    from app.modules.finance import imports as FI
    from app.modules.finance import schema as FS

    # Both use cases end in ctx.commit(); inside the capture's SAVEPOINT that
    # must only flush (the capture commits once, at the end).
    was = ctx.in_batch
    ctx.in_batch = True
    try:
        return _start_import(ctx, FI, FS, account_id, file_name, file_type, media_id, import_id, rows)
    finally:
        ctx.in_batch = was


def _start_import(
    ctx: Ctx,
    FI: Any,
    FS: Any,
    account_id: uuid.UUID,
    file_name: str,
    file_type: str,
    media_id: uuid.UUID | None,
    import_id: uuid.UUID,
    rows: list[dict[str, Any]] | None,
) -> uuid.UUID:
    existing = owned_repo.get(ctx, FI.StatementImport, import_id)
    if existing is not None:
        return existing.id  # type: ignore[no-any-return]
    imp = FI.start_import(
        ctx,
        data=FS.ImportStart(
            id=import_id,
            account_id=account_id,
            file_name=file_name[:255] or "statement",
            file_type=file_type,
            file_media_id=media_id,
        ),
    )
    if rows:
        FI.ingest_rows(
            ctx,
            import_id=imp.id,
            data=FS.ExtractedIn.model_validate({"rows": rows}),
        )
    return imp.id  # type: ignore[no-any-return]


# ---------------------------------------------------------------- Q&A reads
# GAP: the deterministic Q&A (prototype ``qa.ts``) computes over each
# module's own ported calculations; none of them is on a ``public.py`` yet.


def finance_state(ctx: Ctx) -> Any:
    from app.modules.finance import repo as FR

    return FR.load_state(ctx)


def fitness_state(ctx: Ctx) -> Any:
    from app.modules.fitness import repo as XR

    return XR.load_state(ctx)


def habits_world(ctx: Ctx, since: date) -> Any:
    from app.modules.habits import views as HV

    return HV.load_world(ctx, since=since)


def open_task_rows(ctx: Ctx) -> list[Any]:
    from app.modules.tasks.models import Task

    return owned_repo.list_rows(
        ctx,
        Task,
        col(Task.status) == "open",
        order_by=[col(Task.due_date), col(Task.created_at)],
        limit=MAX_OPEN_TASKS,
    )


def calc_modules() -> tuple[Any, Any, Any]:
    """(finance calc, fitness calc, habits logic)."""
    from app.modules.finance import calc as FC
    from app.modules.fitness import calc as XC
    from app.modules.habits import logic as HL

    return FC, XC, HL
