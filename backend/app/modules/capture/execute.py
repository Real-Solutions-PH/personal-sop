"""Write a record card into its module, and take it back out (prototype
``execute`` / ``revert``).

Every row a card writes gets its id from
``derived_id("capture-card", card.id, key)``: the same card saved twice
(a retried request, a replayed sync action) writes the same row, never a
second one. ``key`` is the row's index, plus ``:g<n>`` from the second save
on (a redo or an edit), because several modules return a tombstoned row
unchanged rather than reviving it. ``refs`` keeps exactly the ids written;
undo removes only those, through the owning module's ``public.py``.
"""

import uuid
from collections.abc import Callable
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from typing import Any

from fastapi import HTTPException

from app.modules.capture import journal, ports
from app.modules.capture.models import Capture, RecordCard
from app.modules.capture.parse import js_to_fixed
from app.modules.fitness.public import MealDraft, MealItemDraft, TemplateItemDraft
from app.modules.tasks.public import TaskDraft
from app.shared.context import Ctx
from app.shared.currency import money
from app.shared.domain import invalid
from app.shared.ids import derived_id


@dataclass
class Result:
    refs: list[str]
    prior: dict[str, Any] | None = None
    note: str | None = None


def _num(v: Any) -> float | None:
    """An optional nutrient: a number, or None when the estimate had none."""
    return None if v is None else float(v)


def row_id(card_id: uuid.UUID, i: int, gen: int) -> uuid.UUID:
    return derived_id("capture-card", card_id, str(i) if gen == 0 else f"{i}:g{gen}")


def _uuid(v: object, what: str) -> uuid.UUID:
    try:
        return uuid.UUID(str(v))
    except (TypeError, ValueError):
        raise invalid(
            f"{what}_invalid", "That card points at something unknown"
        ) from None


def _opt_uuid(v: object, what: str) -> uuid.UUID | None:
    return None if v in (None, "") else _uuid(v, what)


def record_at(cap: Capture, offset: int | None) -> datetime:
    return cap.at + timedelta(days=offset or 0)


def record_day(ctx: Ctx, cap: Capture, offset: int | None) -> date:
    return ctx.clock.day_of(cap.at) + timedelta(days=offset or 0)


def _fin_source(source: str) -> Any:
    return {"photo": "photo", "quick_add": "quick-add"}.get(source, "chat")


def _task_source(source: str) -> Any:
    return {"voice": "capture-voice", "photo": "capture-photo"}.get(
        source, "capture-text"
    )


def _meal_source(source: str) -> Any:
    return {
        "photo": "photo",
        "voice": "voice",
        "quick_add": "manual",
        "connector": "connector",
    }.get(source, "text")


def _pace(cardio: dict[str, Any]) -> str | None:
    km, mins = cardio.get("km"), cardio.get("min")
    if not km or not mins:
        return None
    pace = float(mins) / float(km)
    whole = int(pace)
    secs = int((pace % 1) * 60 + 0.5)
    return f"{whole}:{secs:02d} /km"


def execute(
    ctx: Ctx,
    card: RecordCard,
    cap: Capture,
    *,
    gen: int,
    photo_media_id: uuid.UUID | None = None,
) -> Result:
    p: dict[str, Any] = dict(card.payload)
    kind = str(p.get("kind"))
    at = record_at(cap, card.day_offset)
    day = record_day(ctx, cap, card.day_offset)

    def rid(i: int) -> uuid.UUID:
        return row_id(card.id, i, gen)

    if kind == "expense":
        rec = ports.finance.log_expense(
            ctx,
            amount_minor=int(p["amount_minor"]),
            category_id=_opt_uuid(p.get("category_id"), "category"),
            account_id=_opt_uuid(p.get("account_id"), "account"),
            payee=p.get("payee"),
            note=p.get("note")
            or (f"{p['currency']} converted" if p.get("currency") else None),
            source=_fin_source(cap.source),
            at=at,
            receipt_media_id=photo_media_id if p.get("from_receipt") else None,
            record_id=rid(0),
        )
        return Result([str(rec.id)], note=ports.budget_note(ctx, p.get("category_id")))
    if kind == "income":
        rec = ports.finance.log_income(
            ctx,
            amount_minor=int(p["amount_minor"]),
            category_id=_opt_uuid(p.get("category_id"), "category"),
            account_id=_opt_uuid(p.get("account_id"), "account"),
            payee=p.get("payee"),
            source=_fin_source(cap.source),
            at=at,
            record_id=rid(0),
        )
        return Result([str(rec.id)])
    if kind == "transfer":
        if not p.get("from") or not p.get("to"):
            raise invalid("transfer_accounts_required", "Pick both accounts first")
        recs = ports.finance.log_transfer(
            ctx,
            amount_minor=int(p["amount_minor"]),
            from_account_id=_uuid(p["from"], "account"),
            to_account_id=_uuid(p["to"], "account"),
            source=_fin_source(cap.source),
            at=at,
            record_id=rid(0),
        )
        return Result([str(r.id) for r in recs])
    if kind == "planned":
        pl = ports.finance.add_planned(
            ctx,
            name=str(p["name"]),
            amount_minor=int(p["amount_minor"]),
            day=ports.next_day_of_month(day, int(p.get("day") or day.day)),
            account_id=_opt_uuid(p.get("account_id"), "account"),
            category_id=_opt_uuid(p.get("category_id"), "category"),
            planned_id=rid(0),
            repeat="monthly",
        )
        return Result(
            [str(pl.id)], note="Shows on your Plan calendar and in the projection."
        )
    if kind == "task":
        drafts = [
            TaskDraft(
                title=str(t["title"]),
                list_id=_opt_uuid(t.get("list_id"), "list"),
                due_date=date.fromisoformat(t["due_date"])
                if t.get("due_date")
                else None,
                due_time=t.get("due_time"),
                remind=bool(t.get("remind")),
                task_id=rid(i),
            )
            for i, t in enumerate(p.get("tasks") or [])
        ]
        made = ports.tasks.create_tasks(ctx, drafts, source=_task_source(cap.source))
        return Result([str(t.id) for t in made])
    if kind == "taskComplete":
        if not p.get("task_id"):
            raise invalid("task_required", "Pick the task first")
        t = ports.tasks.complete_task(ctx, task_id=_uuid(p["task_id"], "task"))
        left = ports.open_tasks_due_by(ctx, ctx.today)
        return Result(
            [str(t.id)],
            note=f"{left} left for today" if left else "Nothing else due today",
        )
    if kind == "habitLog":
        hid = _uuid(p["habit_id"], "habit")
        prior = ports.habit_log_on(ctx, hid, day)
        lg = ports.habits.log_habit(
            ctx,
            habit_id=hid,
            day=day,
            value=p.get("value"),
            add=bool(p.get("add")),
            source="capture",
            log_id=rid(0),
        )
        st = ports.habit_streak(ctx, hid)
        return Result(
            [str(lg.id)],
            prior={"day": day.isoformat(), "log": prior},
            note=f"{st}-day streak" if st > 1 else None,
        )
    if kind == "habitCreate":
        h = ports.habits.create_habit(
            ctx,
            name=str(p["name"]),
            icon=str(p.get("icon") or "✅"),
            type=p.get("type") or "check",
            target=p.get("target"),
            unit=p.get("unit"),
            days=list(p.get("days") or [0, 1, 2, 3, 4, 5, 6]),
            time=p.get("time"),
            habit_id=rid(0),
        )
        refs = [str(h.id)]
        if p.get("log_today"):
            lg = ports.habits.log_habit(
                ctx, habit_id=h.id, day=day, source="capture", log_id=rid(1)
            )
            refs.append(str(lg.id))
        return Result(
            refs, note="Created and checked for today." if p.get("log_today") else None
        )
    if kind == "routineStart":
        if not p.get("routine_id"):
            raise invalid("routine_required", "Pick the routine first")
        try:
            run = ports.habits.start_routine(
                ctx, routine_id=_uuid(p["routine_id"], "routine"), run_id=rid(0)
            )
        except HTTPException as exc:
            if exc.status_code == 409:
                return Result([], note="Something else is running — finish it first.")
            raise
        return Result(
            [str(run.id)], note="Routine player is running — it's in the Live bar."
        )
    if kind == "workout":
        cardio = p.get("cardio")
        if cardio:
            exercises = [("Run", [(int(cardio.get("min") or 30), 0.0)])]
        else:
            exercises = [
                (
                    str(e["exercise"]),
                    [(int(s["reps"]), float(s["weight"])) for s in e.get("sets") or []],
                )
                for e in p.get("exercises") or []
            ]
        wid = ports.log_workout(
            ctx,
            name=str(p["name"]),
            day=day,
            exercises=exercises,
            cardio=cardio,
            workout_id=rid(0),
        )
        week = ports.finished_workouts_since(ctx, ctx.now - timedelta(days=7))
        pace = _pace(cardio) if cardio else None
        note = (
            f"{pace} · {week} sessions in 7 days"
            if pace
            else f"{week} sessions in the last 7 days"
        )
        return Result([str(wid)], note=note)
    if kind == "weighIn":
        kg = float(p["kg"])
        fat = p.get("body_fat_pct")
        w = ports.fitness.log_weigh_in(
            ctx,
            kg=kg,
            at=at,
            body_fat_pct=float(fat) if fat is not None else None,
            weigh_in_id=rid(0),
        )
        prev = p.get("prev_kg")
        delta_note: str | None = None
        if prev:
            d = kg - float(prev)
            delta_note = f"{'▼' if d <= 0 else '▲'} {js_to_fixed(abs(d), 1)} kg vs last"
        return Result([str(w.id)], note=delta_note)
    if kind == "meal":
        items = [
            MealItemDraft(
                name=str(i["name"]),
                qty=float(i["qty"]),
                unit=str(i["unit"]),
                kcal=float(i["kcal"]),
                protein=float(i["protein"]),
                carbs=float(i["carbs"]),
                fat=float(i["fat"]),
                assumption=i.get("assumption"),
                fiber=_num(i.get("fiber")),
                sat_fat=_num(i.get("sat_fat")),
                sugar=_num(i.get("sugar")),
                sodium=_num(i.get("sodium")),
            )
            for i in p.get("items") or []
        ]
        confidence = float(p.get("confidence") or 0.5)
        photo = photo_media_id if cap.source == "photo" else None
        m = ports.fitness.log_meal(
            ctx,
            MealDraft(
                raw=str(p.get("raw") or ""),
                items=[] if photo else items,
                confidence=confidence,
                label=p.get("label"),
                source=_meal_source(cap.source),
                photo_media_id=photo,
                eaten_at=at,
                meal_id=rid(0),
            ),
        )
        if photo:
            # A photo meal is created pending and filled from the estimate:
            # the same hook fitness's own photo flow uses.
            m = ports.fitness.apply_meal_estimate(
                ctx, meal_id=m.id, items=items, confidence=confidence
            )
        macros = ports.macros_left_today(ctx)
        meal_note = (
            f"{round(macros[0])} kcal · {round(macros[1])} g protein left today"
            if macros
            else None
        )
        return Result([str(m.id)], note=meal_note)
    if kind == "journal":
        e = journal.add_entry(
            ctx,
            body=str(p["body"]),
            day=day,
            source="voice" if cap.source == "voice" else "text",
            mood=p.get("mood"),
            area=p.get("area"),
            tags=list(p.get("tags") or []),
            transcript=p.get("transcript"),
            capture_id=cap.id,
            entry_id=rid(0),
        )
        return Result([str(e.id)], note="Private · only you can see it")
    if kind == "photo":
        return Result([])
    setup = _execute_setup(ctx, kind, p, rid)
    if setup is not None:
        return setup
    raise invalid("card_kind_unknown", "This card can't be saved")


def _execute_setup(
    ctx: Ctx, kind: str, p: dict[str, Any], rid: Callable[[int], uuid.UUID]
) -> Result | None:
    """Cards that set something up (an account, a budget, a routine, a
    workout template, a task list) rather than log an entry."""
    if kind == "accountCreate":
        opening = int(p.get("opening_minor") or 0)
        acc = ports.finance.create_account(
            ctx,
            name=str(p["name"]),
            type=p["type"],
            opening_minor=opening,
            limit_minor=p.get("limit_minor"),
            account_id=rid(0),
        )
        return Result(
            [str(acc.id)],
            note=f"Opening balance {money(opening, ctx.currency)}" if opening else None,
        )
    if kind == "budgetCreate":
        b = ports.finance.create_budget(
            ctx,
            name=str(p["name"]),
            limit_minor=int(p["limit_minor"]),
            category_ids=[_uuid(c, "category") for c in p.get("category_ids") or []],
            budget_id=rid(0),
        )
        return Result([str(b.id)], note="Shows on your Budgets from this month.")
    if kind == "routineCreate":
        days = list(p.get("days") or [0, 1, 2, 3, 4, 5, 6])
        steps: list[tuple[uuid.UUID, int]] = []
        made: list[str] = []
        for i, st in enumerate(p.get("steps") or []):
            minutes = int(st["minutes"])
            hid = _opt_uuid(st.get("habit_id"), "habit")
            if hid is None:
                # A step names a habit the person does not have yet: it is
                # made the way the routine screen's "add step" makes one.
                h = ports.habits.create_habit(
                    ctx,
                    name=str(st["name"]),
                    icon=str(st.get("icon") or "✅"),
                    type="duration",
                    target=minutes,
                    days=days,
                    time=p.get("time"),
                    habit_id=rid(i + 1),
                )
                hid = h.id
                made.append(str(h.id))
            steps.append((hid, minutes))
        r = ports.habits.create_routine(
            ctx,
            name=str(p["name"]),
            icon=str(p.get("icon") or "🌅"),
            steps=steps,
            days=days,
            time=p.get("time"),
            routine_id=rid(0),
        )
        total = sum(m for _, m in steps)
        return Result([str(r.id), *made], note=f"{len(steps)} steps · {total} min")
    if kind == "templateCreate":
        t, new = ports.fitness.create_template(
            ctx,
            name=str(p["name"]),
            items=[
                TemplateItemDraft(
                    exercise=str(e["exercise"]),
                    sets=int(e.get("sets") or 3),
                    reps=e.get("reps"),
                )
                for e in p.get("exercises") or []
            ],
            template_id=rid(0),
        )
        return Result(
            [str(t.id)],
            note=f"New exercises: {', '.join(new)}" if new else None,
        )
    if kind == "listCreate":
        lst = ports.tasks.create_list(
            ctx,
            name=str(p["name"]),
            kind="shopping" if p.get("list_kind") == "shopping" else "standard",
            list_id=rid(0),
        )
        items = [str(t) for t in p.get("items") or []]
        tasks = ports.tasks.create_tasks(
            ctx,
            [
                TaskDraft(title=t, list_id=lst.id, task_id=rid(i + 1))
                for i, t in enumerate(items)
            ],
            source="capture-text",
        )
        return Result(
            [str(lst.id), *(str(t.id) for t in tasks)],
            note=f"{len(tasks)} items" if tasks else None,
        )
    return None


def revert(ctx: Ctx, card: RecordCard) -> None:
    """Remove exactly what the card wrote (raises the owning module's 404 or
    409 when the row was deleted or changed in a way it refuses)."""
    p: dict[str, Any] = dict(card.payload)
    kind = str(p.get("kind"))
    refs = [uuid.UUID(r) for r in card.refs]
    if kind in ("expense", "income", "transfer"):
        if refs:
            ports.finance.delete_records(ctx, record_ids=refs)
    elif kind == "planned":
        for r in refs:
            ports.finance.delete_planned(ctx, planned_id=r)
    elif kind == "task":
        if refs:
            ports.tasks.remove_tasks(ctx, task_ids=refs)
    elif kind == "taskComplete":
        for r in refs:
            ports.tasks.uncomplete_task(ctx, task_id=r)
    elif kind == "habitLog":
        meta: dict[str, Any] = dict(card.prior or {})
        prior = meta.get("log")
        day = date.fromisoformat(str(meta.get("day")))
        if isinstance(prior, dict):
            ports.put_back_habit_log(ctx, prior, _uuid(p["habit_id"], "habit"), day)
        else:
            for r in refs:
                ports.habits.delete_log(ctx, log_id=r)
    elif kind == "habitCreate":
        if refs:
            ports.delete_habit(ctx, refs[0])
    elif kind == "workout":
        for r in refs:
            ports.fitness.delete_workout(ctx, workout_id=r)
    elif kind == "weighIn":
        for r in refs:
            ports.fitness.delete_weigh_in(ctx, weigh_in_id=r)
    elif kind == "meal":
        for r in refs:
            ports.fitness.delete_meal(ctx, meal_id=r)
    elif kind == "journal":
        for r in refs:
            journal.delete_entry_row(ctx, r)
    elif kind == "accountCreate":
        for r in refs:
            ports.finance.delete_account(ctx, account_id=r)
    elif kind == "budgetCreate":
        for r in refs:
            ports.finance.delete_budget(ctx, budget_id=r)
    elif kind == "routineCreate":
        # The routine first, then the habits this card made for its steps
        # (habits it reused stay).
        if refs:
            ports.habits.delete_routine(ctx, routine_id=refs[0])
        for r in refs[1:]:
            ports.delete_habit(ctx, r)
    elif kind == "templateCreate":
        # Exercises it added stay in the library, as a logged workout's do.
        for r in refs:
            ports.fitness.delete_template(ctx, template_id=r)
    elif kind == "listCreate":
        if refs[1:]:
            ports.tasks.remove_tasks(ctx, task_ids=refs[1:])
        if refs:
            ports.tasks.delete_list(ctx, list_id=refs[0])
    # routineStart, photo and command write nothing undoable of their own:
    # a running routine is ended from its player (the prototype did the same).
