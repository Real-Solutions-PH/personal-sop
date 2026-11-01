"""Fern's changes to fitness (ADR-0015): finding things by name, and the
edits and removals behind the capture module's ``edit`` and ``remove``
cards.

Every change runs through this module's own use cases in ``services``,
which end in ``ctx.commit()``; here they only flush, because the card's
save owns the transaction. ``edit`` returns what Undo needs and
``undo_edit`` puts it back:

- exercises, weigh-ins, foods, settings and the day's macro target keep
  their earlier field values;
- a template keeps its earlier name and slots;
- a workout or a meal keeps a snapshot of itself and every child row
  (exercises and sets, or items), and Undo writes the snapshot back,
  tombstoning rows the edit added and reviving rows it removed.

An edit can also create its row (a new exercise, a workout started from
chat): its Undo deletes it again, or discards a workout still in progress.
"""

import uuid
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import date, datetime, timedelta
from typing import Any

from sqlmodel import col

from app.modules.fitness import calc as C
from app.modules.fitness import food_library, repo, services
from app.modules.fitness import foods as F
from app.modules.fitness.models import (
    Exercise,
    FitnessSettings,
    FoodItem,
    MacroTarget,
    Meal,
    MealItem,
    WeighIn,
    Workout,
    WorkoutExercise,
    WorkoutSet,
    WorkoutTemplate,
)
from app.modules.profile import public as profile_public
from app.shared import owned_repo
from app.shared.context import Ctx
from app.shared.domain import invalid
from app.shared.ids import derived_id

EDITS = ("exercise", "template", "workout", "meal", "weighIn", "target", "settings")
EDITS_TOO = ("food",)
# What a removal does to each: archive (an exercise keeps its history) or
# delete (with a restore).
REMOVALS = ("exercise", "template", "workout", "food")
ARCHIVED = ("exercise",)

EXERCISE_FIELDS = (
    "name",
    "muscle",
    "equipment",
    "load_type",
    "rep_min",
    "rep_max",
    "increment",
    "track",
    "archived",
)
WEIGH_IN_FIELDS = ("weight_kg", "body_fat_pct", "note", "measured_at")
TARGET_FIELDS = (
    "kcal",
    "protein",
    "carbs",
    "fat",
    "sat_fat_max_g",
    "sugar_max_g",
    "sodium_max_mg",
    "fiber_g",
)
SETTINGS_FIELDS = (
    "units",
    "rest_sec",
    "weekly_target",
    "weigh_in_reminder",
    "progression",
    "goal_direction",
    "goal_weight",
)


@contextmanager
def _flush_only(ctx: Ctx) -> Iterator[None]:
    """Run use cases that end in ``ctx.commit()`` inside the caller's
    transaction (the same switch the sync engine uses)."""
    was = ctx.in_batch
    ctx.in_batch = True
    try:
        yield
    finally:
        ctx.in_batch = was


# ------------------------------------------------------------- finding


def _fold(s: str) -> str:
    return food_library.fold(s)


def best_matches(query: str, names: list[tuple[Any, str]]) -> list[Any]:
    """The rows a name refers to: the exact name (any case) alone, else
    every row whose name holds each word said, else every row whose name
    holds the words as one phrase."""
    q = _fold(query)
    if not q:
        return []
    exact = [row for row, n in names if _fold(n) == q]
    if exact:
        return exact[:1]
    words = set(q.split())
    every = [row for row, n in names if words <= set(_fold(n).split())]
    if every:
        return every
    return [row for row, n in names if q in _fold(n)]


def exercises_like(ctx: Ctx, name: str) -> list[Exercise]:
    """Library exercises (archived ones too) a name refers to."""
    services.ensure_settings(ctx)  # a first visit seeds the library
    rows = [e for e in owned_repo.list_rows(ctx, Exercise) if e.merged_into_id is None]
    found = best_matches(name, [(e, n) for e in rows for n in (e.name, *e.aliases)])
    return list({e.id: e for e in found}.values())


def templates_like(ctx: Ctx, name: str) -> list[WorkoutTemplate]:
    services.ensure_settings(ctx)
    rows = owned_repo.list_rows(ctx, WorkoutTemplate)
    return best_matches(name, [(t, t.name) for t in rows])


def foods_like(ctx: Ctx, name: str) -> list[FoodItem]:
    hit = food_library.find_food(ctx, name)
    if hit is not None:
        return [hit]
    return food_library.search_foods(ctx, name, limit=5)


def active_workout(ctx: Ctx) -> Workout | None:
    return repo.active_workout(ctx)


def workout_by_id(ctx: Ctx, workout_id: str | None) -> Workout | None:
    """The workout with this id; with none, the one in progress, else the
    latest finished one."""
    if workout_id:
        try:
            wid = uuid.UUID(workout_id)
        except ValueError:
            return None
        return owned_repo.get(ctx, Workout, wid)
    active = repo.active_workout(ctx)
    if active is not None:
        return active
    rows = owned_repo.list_rows(
        ctx,
        Workout,
        col(Workout.status) == "finished",
        order_by=[col(Workout.started_at).desc()],
        limit=1,
    )
    return rows[0] if rows else None


def exercise_public(e: Exercise) -> dict[str, Any]:
    out: dict[str, Any] = {
        "id": str(e.id),
        "name": e.name,
        "muscle": e.muscle,
        "equipment": e.equipment,
        "type": e.load_type,
        "reps": f"{e.rep_min}-{e.rep_max}",
    }
    if e.track:
        out["track"] = e.track
    if e.archived:
        out["archived"] = True
    return out


def list_exercises(ctx: Ctx, query: str | None) -> list[dict[str, Any]]:
    services.ensure_settings(ctx)
    rows = (
        exercises_like(ctx, query)
        if query
        else owned_repo.list_rows(ctx, Exercise, order_by=[col(Exercise.name)])
    )
    return [exercise_public(e) for e in rows[:40]]


def template_public(ctx: Ctx, t: WorkoutTemplate) -> dict[str, Any]:
    names = {e.id: e.name for e in owned_repo.list_rows(ctx, Exercise)}
    items = []
    for it in repo.template_items(ctx, t.id):
        item: dict[str, Any] = {
            "exercise": names.get(it.exercise_id, "?"),
            "sets": it.sets,
        }
        if it.target_sec:
            item["minutes"] = round(it.target_sec / 60, 1)
        items.append(item)
    return {"id": str(t.id), "name": t.name, "exercises": items}


def list_templates(ctx: Ctx, query: str | None) -> list[dict[str, Any]]:
    services.ensure_settings(ctx)
    rows = (
        templates_like(ctx, query)
        if query
        else owned_repo.list_rows(
            ctx, WorkoutTemplate, order_by=[col(WorkoutTemplate.sort_order)]
        )
    )
    return [template_public(ctx, t) for t in rows[:20]]


def _set_public(n: int, s: WorkoutSet) -> dict[str, Any]:
    out: dict[str, Any] = {"set": n, "reps": s.reps, "kg": s.weight}
    if s.kind != "working":
        out["kind"] = s.kind
    if s.duration_sec is not None:
        out["minutes"] = round(s.duration_sec / 60, 1)
    if s.speed_kmh is not None:
        out["kmh"] = s.speed_kmh
    out["done"] = s.completed_at is not None
    return out


def workout_public(ctx: Ctx, w: Workout) -> dict[str, Any]:
    """A workout as Fern reads it: every exercise with its sets numbered
    from 1, the numbers its edits name."""
    names = {e.id: e.name for e in owned_repo.list_rows(ctx, Exercise)}
    wes = repo.workout_exercises(ctx, w.id)
    sets = repo.sets_of(ctx, [we.id for we in wes])
    out: dict[str, Any] = {
        "id": str(w.id),
        "name": w.name,
        "day": ctx.clock.day_of(w.started_at).isoformat(),
        "status": w.status,
        "exercises": [
            {
                "exercise": names.get(we.exercise_id, "?"),
                **({"note": we.note} if we.note else {}),
                "sets": [_set_public(i + 1, s) for i, s in enumerate(sets[we.id])],
            }
            for we in wes
        ],
    }
    if w.notes:
        out["notes"] = w.notes
    if w.cardio:
        out["cardio"] = w.cardio
    return out


def recent_workouts(ctx: Ctx, *, days: int) -> list[Workout]:
    return owned_repo.list_rows(
        ctx,
        Workout,
        col(Workout.started_at) >= ctx.now - timedelta(days=days),
        col(Workout.status) != "discarded",
        order_by=[col(Workout.started_at).desc()],
        limit=15,
    )


def meal_items_public(ctx: Ctx, meal_id: uuid.UUID) -> list[dict[str, Any]]:
    return [
        {
            "id": str(it.id),
            "name": it.name,
            "qty": it.qty,
            "unit": it.unit,
            "kcal": round(it.kcal),
            "protein": round(it.protein, 1),
        }
        for it in repo.meal_items(ctx, meal_id)
    ]


def workout_exercises(ctx: Ctx, w: Workout) -> list[tuple[WorkoutExercise, str]]:
    names = {e.id: e.name for e in owned_repo.list_rows(ctx, Exercise)}
    return [
        (we, names.get(we.exercise_id, "")) for we in repo.workout_exercises(ctx, w.id)
    ]


def meal_item_rows(ctx: Ctx, meal_id: uuid.UUID) -> list[MealItem]:
    return repo.meal_items(ctx, meal_id)


def sets_of(ctx: Ctx, we_id: uuid.UUID) -> list[WorkoutSet]:
    return repo.sets_of(ctx, [we_id]).get(we_id, [])


def target_today(ctx: Ctx) -> dict[str, Any] | None:
    """The macro target in force today, as its fields."""
    t = C.target_for(repo.load_state(ctx, meals=False), ctx.today)
    if t is None:
        return None
    return {k: getattr(t, k) for k in TARGET_FIELDS}


def settings_row(ctx: Ctx) -> FitnessSettings:
    return services.ensure_settings(ctx)


def target_row_id(ctx: Ctx) -> uuid.UUID:
    """Today's target version (one per effective day)."""
    return derived_id("macro-target", ctx.user_id, ctx.today.isoformat())


# ------------------------------------------------------------- snapshots

_TIMES = {"completed_at", "eaten_at", "ended_at", "measured_at"}
_IDS = {"exercise_id"}
_WE = ("exercise_id", "position", "note")
_SET = (
    "position",
    "reps",
    "weight",
    "kind",
    "duration_sec",
    "speed_kmh",
    "completed_at",
)
_MEAL = ("eaten_at", "label", "status", "confidence", "follow_up", "raw_input")
_ITEM = (
    "position",
    "name",
    "qty",
    "unit",
    "kcal",
    "protein",
    "carbs",
    "fat",
    "assumption",
    "fiber",
    "sat_fat",
    "sugar",
    "sodium",
)


def _enc(v: Any) -> Any:
    if isinstance(v, uuid.UUID):
        return str(v)
    if isinstance(v, datetime | date):
        return v.isoformat()
    return v


def _dec(k: str, v: Any) -> Any:
    if v is None:
        return None
    if k in _IDS:
        return uuid.UUID(str(v))
    if k in _TIMES:
        return datetime.fromisoformat(str(v))
    return v


def _state(row: Any, fields: tuple[str, ...]) -> dict[str, Any]:
    return {k: _enc(getattr(row, k)) for k in fields} | {
        "gone": row.deleted_at is not None
    }


def _put(ctx: Ctx, row: Any, st: dict[str, Any], fields: tuple[str, ...]) -> None:
    for k in fields:
        setattr(row, k, _dec(k, st.get(k)))
    if not st["gone"]:
        row.deleted_at = None
    elif row.deleted_at is None:
        row.deleted_at = ctx.now
    ctx.session.add(row)
    ctx.session.flush()


def _family(ctx: Ctx, w: Workout) -> tuple[list[WorkoutExercise], list[WorkoutSet]]:
    wes = owned_repo.list_rows(
        ctx,
        WorkoutExercise,
        col(WorkoutExercise.workout_id) == w.id,
        include_deleted=True,
    )
    sets = owned_repo.list_rows(
        ctx,
        WorkoutSet,
        col(WorkoutSet.workout_exercise_id).in_([we.id for we in wes]),
        include_deleted=True,
    )
    return wes, sets


def workout_snapshot(ctx: Ctx, w: Workout) -> dict[str, Any]:
    wes, sets = _family(ctx, w)
    return {
        "workout": {
            "name": w.name,
            "notes": w.notes,
            "status": w.status,
            "ended_at": _enc(w.ended_at),
        },
        "we": {str(r.id): _state(r, _WE) for r in wes},
        "sets": {str(r.id): _state(r, _SET) for r in sets},
    }


def _restore_workout(ctx: Ctx, w: Workout, snap: dict[str, Any]) -> None:
    wes, sets = _family(ctx, w)
    keep_we: dict[str, Any] = snap.get("we") or {}
    keep_set: dict[str, Any] = snap.get("sets") or {}
    # Rows the edit added go first; then every exercise whose slot moved is
    # parked on a free negative slot, since (workout, position) is unique.
    for s in sets:
        if str(s.id) not in keep_set and s.deleted_at is None:
            owned_repo.soft_delete(ctx, s)
    for we in wes:
        if str(we.id) not in keep_we and we.deleted_at is None:
            owned_repo.soft_delete(ctx, we)
    moved = [
        we
        for we in wes
        if str(we.id) in keep_we and keep_we[str(we.id)]["position"] != we.position
    ]
    for i, we in enumerate(moved):
        we.position = -1 - i
        ctx.session.add(we)
        ctx.session.flush()
    for we in wes:
        if str(we.id) in keep_we:
            _put(ctx, we, keep_we[str(we.id)], _WE)
    for s in sets:
        if str(s.id) in keep_set:
            _put(ctx, s, keep_set[str(s.id)], _SET)
    head = snap.get("workout") or {}
    w.name = str(head.get("name") or w.name)
    w.notes = head.get("notes")
    if head.get("status") == "in_progress" and w.status == "finished":
        # Undo of a finish: the workout is in progress again, on the Live
        # bar. Habits it ticked stay ticked, as after the logger's finish.
        w.status = "in_progress"
        w.ended_at = None
        profile_public.start_live(
            ctx,
            kind="workout",
            label=services.live_label(ctx, w),
            href=services.WORKOUT_HREF,
            ref_id=w.id,
        )
    ctx.session.add(w)
    ctx.session.flush()
    services._relabel(ctx, w.id)
    services._dirty_at(ctx, w.started_at)


def meal_snapshot(ctx: Ctx, m: Meal) -> dict[str, Any]:
    items = owned_repo.list_rows(
        ctx, MealItem, col(MealItem.meal_id) == m.id, include_deleted=True
    )
    return {
        "meal": {k: _enc(getattr(m, k)) for k in _MEAL},
        "items": {str(r.id): _state(r, _ITEM) for r in items},
    }


def _restore_meal(ctx: Ctx, m: Meal, snap: dict[str, Any]) -> None:
    was = m.eaten_at
    keep: dict[str, Any] = snap.get("items") or {}
    for it in owned_repo.list_rows(
        ctx, MealItem, col(MealItem.meal_id) == m.id, include_deleted=True
    ):
        if str(it.id) in keep:
            _put(ctx, it, keep[str(it.id)], _ITEM)
        elif it.deleted_at is None:
            owned_repo.soft_delete(ctx, it)
    head: dict[str, Any] = snap.get("meal") or {}
    for k in _MEAL:
        setattr(m, k, _dec(k, head.get(k)))
    ctx.session.add(m)
    ctx.session.flush()
    services._dirty_at(ctx, was)
    services._dirty_at(ctx, m.eaten_at)


# ------------------------------------------------------------- edits


def _uuid(v: Any) -> uuid.UUID:
    return uuid.UUID(str(v))


def _exercise_data(e: Exercise) -> dict[str, Any]:
    return {k: getattr(e, k) for k in EXERCISE_FIELDS}


def _edit_exercise(
    ctx: Ctx, row_id: uuid.UUID, changes: dict[str, Any]
) -> dict[str, Any]:
    row = owned_repo.get(ctx, Exercise, row_id, include_deleted=True)
    if row is None or row.deleted_at is not None:
        services.ensure_settings(ctx)
        data = {
            "name": "",
            "equipment": "barbell",
            "muscle": "chest",
            "load_type": "weight",
            "rep_min": 8,
            "rep_max": 12,
            "increment": 2.5,
            "archived": False,
            "track": None,
        } | changes
        with _flush_only(ctx):
            services.upsert_exercise(ctx=ctx, data=data, exercise_id=row_id)
        return {"created": True}
    before = _exercise_data(row)
    with _flush_only(ctx):
        services.upsert_exercise(ctx=ctx, data=before | changes, exercise_id=row_id)
    return {k: before[k] for k in changes if k in before}


def template_slots(ctx: Ctx, t: WorkoutTemplate) -> list[dict[str, Any]]:
    return [
        {"exercise_id": str(i.exercise_id), "sets": i.sets, "target_sec": i.target_sec}
        for i in repo.template_items(ctx, t.id)
    ]


def _edit_template(
    ctx: Ctx, row_id: uuid.UUID, changes: dict[str, Any]
) -> dict[str, Any]:
    t = owned_repo.require(ctx, WorkoutTemplate, row_id, what="template")
    before: dict[str, Any] = {"name": t.name, "items": template_slots(ctx, t)}
    slots: list[dict[str, Any]] = list(changes.get("items") or before["items"])
    ids: list[uuid.UUID] = []
    for s in slots:
        if s.get("exercise_id"):
            ids.append(_uuid(s["exercise_id"]))
        else:
            ids.append(services.find_or_create_exercise(ctx, str(s["exercise"])).id)
    services._put_template(
        ctx,
        t.id,
        str(changes.get("name") or t.name),
        [
            (ex_id, int(s.get("sets") or services.DEFAULT_SETS))
            for ex_id, s in zip(ids, slots, strict=True)
        ],
        target_secs=[s.get("target_sec") for s in slots],
    )
    ctx.session.flush()
    return before


def _write_set(
    ctx: Ctx, w: Workout, we_id: uuid.UUID, set_id: uuid.UUID, spec: dict[str, Any]
) -> None:
    patch: dict[str, Any] = {}
    if spec.get("reps") is not None:
        patch["reps"] = int(spec["reps"])
    if spec.get("kg") is not None:
        patch["weight"] = float(spec["kg"])
    if spec.get("minutes") is not None:
        patch["duration_sec"] = round(float(spec["minutes"]) * 60)
    if spec.get("kmh") is not None:
        patch["speed_kmh"] = float(spec["kmh"])
    if spec.get("kind"):
        patch["kind"] = spec["kind"]
    if spec.get("done") is not None:
        # A set added to a finished workout is dated with it, as a workout
        # logged from chat is; one done now is done now.
        done_at = w.started_at if w.status == "finished" else ctx.now
        patch["completed_at"] = done_at if spec["done"] else None
    if patch:
        services.update_set(
            ctx=ctx, workout_id=w.id, we_id=we_id, set_id=set_id, patch=patch
        )


def _new_set(ctx: Ctx, w: Workout, we_id: uuid.UUID, spec: dict[str, Any]) -> None:
    st = services.add_set(ctx=ctx, workout_id=w.id, we_id=we_id)
    _write_set(ctx, w, we_id, st.id, {"done": True} | spec)


def _edit_workout(ctx: Ctx, row_id: uuid.UUID, ch: dict[str, Any]) -> dict[str, Any]:
    if "start" in ch:
        start: dict[str, Any] = ch["start"]
        with _flush_only(ctx):
            services.start_workout(
                ctx=ctx,
                source=start.get("source") or "empty",
                template_id=_uuid(start["template_id"])
                if start.get("template_id")
                else None,
                from_workout_id=_uuid(start["from_workout_id"])
                if start.get("from_workout_id")
                else None,
                workout_id=row_id,
            )
        return {"created": True}
    w = owned_repo.require(ctx, Workout, row_id, what="workout")
    before = workout_snapshot(ctx, w)
    with _flush_only(ctx):
        meta = {k: ch[k] for k in ("name", "notes") if k in ch}
        if meta:
            services.update_workout_meta(ctx=ctx, workout_id=w.id, patch=meta)
        for r in ch.get("remove_sets") or []:
            services.remove_set(
                ctx=ctx,
                workout_id=w.id,
                we_id=_uuid(r["we_id"]),
                set_id=_uuid(r["set_id"]),
            )
        for s in ch.get("sets") or []:
            if s.get("set_id"):
                _write_set(ctx, w, _uuid(s["we_id"]), _uuid(s["set_id"]), s)
            else:
                _new_set(ctx, w, _uuid(s["we_id"]), s)
        for r in ch.get("replace") or []:
            ex = services.find_or_create_exercise(ctx, str(r["with"]))
            services.replace_exercise(
                ctx=ctx, workout_id=w.id, we_id=_uuid(r["we_id"]), exercise_id=ex.id
            )
        for n in ch.get("notes_for") or []:
            services.set_exercise_note(
                ctx=ctx, workout_id=w.id, we_id=_uuid(n["we_id"]), note=str(n["note"])
            )
        for we_id in ch.get("remove") or []:
            services.remove_exercise(ctx=ctx, workout_id=w.id, we_id=_uuid(we_id))
        for a in ch.get("add") or []:
            ex = services.find_or_create_exercise(ctx, str(a["exercise"]))
            (we,) = services.add_exercises(
                ctx=ctx, workout_id=w.id, exercise_ids=[ex.id]
            )
            given = a.get("sets") or []
            if given:
                # The sets said replace the ones planned from history.
                for s in sets_of(ctx, we.id):
                    services.remove_set(
                        ctx=ctx, workout_id=w.id, we_id=we.id, set_id=s.id
                    )
                for spec in given:
                    _new_set(ctx, w, we.id, spec)
        if ch.get("order"):
            _reorder(ctx, w, [_uuid(i) for i in ch["order"]])
        if ch.get("finish"):
            services.finish_workout(ctx=ctx, workout_id=w.id, unfinished=ch["finish"])
    return before


def _reorder(ctx: Ctx, w: Workout, order: list[uuid.UUID]) -> None:
    """Put the workout's exercises in this order (any not named keep their
    turn after them), parking each on a free slot first."""
    wes = repo.workout_exercises(ctx, w.id)
    by_id = {we.id: we for we in wes}
    ranked = [by_id[i] for i in order if i in by_id] + [
        we for we in wes if we.id not in order
    ]
    slots = sorted(we.position for we in wes)
    for i, we in enumerate(ranked):
        we.position = -1 - i
        ctx.session.add(we)
        ctx.session.flush()
    for we, pos in zip(ranked, slots, strict=True):
        we.position = pos
        ctx.session.add(we)
        ctx.session.flush()
    services._dirty_at(ctx, w.started_at)


def _edit_meal(ctx: Ctx, row_id: uuid.UUID, ch: dict[str, Any]) -> dict[str, Any]:
    m = owned_repo.require(ctx, Meal, row_id, what="meal")
    before = meal_snapshot(ctx, m)
    with _flush_only(ctx):
        patch: dict[str, Any] = {}
        if ch.get("label"):
            patch["label"] = ch["label"]
        if ch.get("day"):
            local = m.eaten_at.astimezone(ctx.clock.zone)
            patch["eaten_at"] = datetime.combine(
                date.fromisoformat(str(ch["day"])), local.timetz()
            )
        if patch:
            services.update_meal(ctx=ctx, meal_id=m.id, patch=patch)
        for item_id in ch.get("remove_items") or []:
            services.remove_meal_item(ctx=ctx, meal_id=m.id, item_id=_uuid(item_id))
        for e in ch.get("edit_items") or []:
            iid = _uuid(e["id"])
            if e.get("qty") is not None:
                services.set_item_qty(
                    ctx=ctx, meal_id=m.id, item_id=iid, qty=float(e["qty"])
                )
            values = {k: v for k, v in e.items() if k not in ("id", "qty")}
            if values:
                services.set_item_macros(
                    ctx=ctx, meal_id=m.id, item_id=iid, patch=values
                )
        for it in ch.get("add_items") or []:
            services.add_meal_item(
                ctx=ctx,
                meal_id=m.id,
                item=F.ItemDraft(
                    str(it["name"]),
                    float(it.get("qty") or 1),
                    str(it.get("unit") or "serving"),
                    float(it.get("kcal") or 0),
                    float(it.get("protein") or 0),
                    float(it.get("carbs") or 0),
                    float(it.get("fat") or 0),
                    it.get("assumption"),
                    fiber=it.get("fiber"),
                    sat_fat=it.get("sat_fat"),
                    sugar=it.get("sugar"),
                    sodium=it.get("sodium"),
                ),
            )
        if ch.get("confirmed"):
            services.confirm_meal(ctx=ctx, meal_id=m.id)
    return before


def _edit_weigh_in(
    ctx: Ctx, row_id: uuid.UUID, changes: dict[str, Any]
) -> dict[str, Any]:
    w = owned_repo.require(ctx, WeighIn, row_id, what="weigh_in")
    before = {k: _enc(getattr(w, k)) for k in changes if k in WEIGH_IN_FIELDS}
    with _flush_only(ctx):
        services.update_weigh_in(
            ctx=ctx,
            weigh_in_id=w.id,
            patch={k: _dec(k, v) for k, v in changes.items() if k in WEIGH_IN_FIELDS},
        )
    return before


def _edit_target(
    ctx: Ctx, row_id: uuid.UUID, changes: dict[str, Any]
) -> dict[str, Any]:
    if row_id != target_row_id(ctx):
        raise invalid("target_moved", "That target was for another day")
    row = owned_repo.get(ctx, MacroTarget, row_id)
    before: dict[str, Any] = (
        {k: getattr(row, k) for k in TARGET_FIELDS} if row else {"created": True}
    )
    now = target_today(ctx) or {}
    values: dict[str, Any] = {k: now.get(k) for k in TARGET_FIELDS} | {
        k: v for k, v in changes.items() if k in TARGET_FIELDS
    }
    if any(values.get(k) is None for k in ("kcal", "protein", "carbs", "fat")):
        raise invalid(
            "target_incomplete", "A target needs kcal, protein, carbs and fat"
        )
    with _flush_only(ctx):
        services.set_macro_target(ctx=ctx, **values)
    return before


def _edit_settings(
    ctx: Ctx, row_id: uuid.UUID, changes: dict[str, Any]
) -> dict[str, Any]:
    row = services.ensure_settings(ctx)
    if row.id != row_id:
        raise invalid("settings_unknown", "Those settings are not yours")
    patch = {k: v for k, v in changes.items() if k in SETTINGS_FIELDS}
    before = {k: getattr(row, k) for k in patch}
    with _flush_only(ctx):
        services.update_settings(ctx=ctx, patch=patch)
    return before


def _edit_food(ctx: Ctx, row_id: uuid.UUID, changes: dict[str, Any]) -> dict[str, Any]:
    row = owned_repo.require(ctx, FoodItem, row_id, what="food")
    before = {k: getattr(row, k) for k in changes if k in food_library.EDITABLE}
    food_library.update_food(ctx, row_id, changes)
    return before


_EDIT = {
    "exercise": _edit_exercise,
    "template": _edit_template,
    "workout": _edit_workout,
    "meal": _edit_meal,
    "weighIn": _edit_weigh_in,
    "target": _edit_target,
    "settings": _edit_settings,
    "food": _edit_food,
}


def edit(
    ctx: Ctx, entity: str, row_id: uuid.UUID, changes: dict[str, Any]
) -> dict[str, Any]:
    """Apply an edit card's ``changes``; returns what ``undo_edit`` needs
    (always JSON: it is stored on the card)."""
    before = _EDIT[entity](ctx, row_id, changes)
    return {k: _enc(v) for k, v in before.items()}


def undo_edit(ctx: Ctx, entity: str, row_id: uuid.UUID, before: dict[str, Any]) -> None:
    """Put back what ``edit`` changed."""
    if before.get("created"):
        if entity == "workout":
            w = owned_repo.get(ctx, Workout, row_id)
            if w is not None:
                from app.modules.fitness import public

                with _flush_only(ctx):
                    public.delete_workout(ctx, workout_id=row_id)
        elif entity == "exercise":
            ex = owned_repo.get(ctx, Exercise, row_id)
            if ex is not None:
                owned_repo.soft_delete(ctx, ex)
        elif entity == "target":
            t = owned_repo.get(ctx, MacroTarget, row_id)
            if t is not None:
                owned_repo.soft_delete(ctx, t)
                services._dirty(ctx, t.effective_from)
        return
    if entity == "workout":
        w = owned_repo.require(ctx, Workout, row_id, what="workout")
        _restore_workout(ctx, w, before)
    elif entity == "meal":
        m = owned_repo.require(ctx, Meal, row_id, what="meal")
        _restore_meal(ctx, m, before)
    elif entity == "template":
        _edit_template(ctx, row_id, before)
    elif entity == "target":
        with _flush_only(ctx):
            services.set_macro_target(ctx=ctx, **before)
    else:
        _EDIT[entity](ctx, row_id, before)


def remove(ctx: Ctx, entity: str, row_id: uuid.UUID) -> None:
    """Archive an exercise; delete a template, workout or food."""
    with _flush_only(ctx):
        if entity == "exercise":
            services.set_exercise_archived(ctx=ctx, exercise_id=row_id, archived=True)
        elif entity == "template":
            services.delete_template(ctx=ctx, template_id=row_id)
        elif entity == "workout":
            from app.modules.fitness import public

            public.delete_workout(ctx, workout_id=row_id)
        elif entity == "food":
            food_library.delete_food(ctx, row_id)


def restore(ctx: Ctx, entity: str, row_id: uuid.UUID) -> None:
    """Undo of ``remove``. A workout discarded while in progress stays
    discarded (409 ``workout_not_restorable``), as from the logger."""
    with _flush_only(ctx):
        if entity == "exercise":
            services.set_exercise_archived(ctx=ctx, exercise_id=row_id, archived=False)
        elif entity == "template":
            services.restore_template(ctx=ctx, template_id=row_id)
        elif entity == "workout":
            services.restore_workout(ctx=ctx, workout_id=row_id)
        elif entity == "food":
            food_library.restore_food(ctx, row_id)
