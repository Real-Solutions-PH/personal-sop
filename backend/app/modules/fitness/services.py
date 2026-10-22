"""Fitness use cases: one function per action in
``shared/prototype/fitness/actions.ts``.

Each use case takes a keyword-only ``ctx`` and ends with ``ctx.commit()``;
the ``_``-prefixed helpers and :mod:`app.modules.fitness.public` only flush.

Server-derived child rows (the exercises and planned sets a workout starts
with, template items, meal items) get ``derived_id`` ids keyed by their
position, so the device that built the same rows offline converges on the
same ids. Positions are never reused: a tombstone keeps its slot.
"""

import uuid
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from typing import Any, Literal

from sqlalchemy.exc import IntegrityError
from sqlmodel import col

from app.modules.fitness import calc as C
from app.modules.fitness import foods as F
from app.modules.fitness import repo
from app.modules.fitness.models import (
    Exercise,
    FitnessSettings,
    MacroTarget,
    Meal,
    MealItem,
    RestTimer,
    TemplateItem,
    WeighIn,
    Workout,
    WorkoutExercise,
    WorkoutSet,
    WorkoutTemplate,
)
from app.modules.habits import public as habits_public
from app.modules.media import public as media_public
from app.modules.profile import public as profile_public
from app.modules.stats import public as stats_public
from app.shared import owned_repo
from app.shared.context import Ctx
from app.shared.domain import conflict, invalid, not_found
from app.shared.ids import derived_id

WORKOUT_HREF = "/fitness/workout"
DEFAULT_SETS = 3


def _dirty(ctx: Ctx, day: date) -> None:
    stats_public.mark_dirty(ctx, module="fitness", day=day)


def _dirty_at(ctx: Ctx, at: datetime) -> None:
    _dirty(ctx, ctx.clock.day_of(at))


# --------------------------------------------------------------------------
# Settings and the seeded library
# --------------------------------------------------------------------------

# The prototype's exercise library and split (``data.ts`` EXERCISES /
# TEMPLATES): a new user starts with them, as on the device.
LIBRARY: tuple[tuple[str, str, str, str, str, int, int, float, bool], ...] = (
    ("bench", "Barbell Bench Press", "barbell", "chest", "weight", 6, 10, 2.5, False),
    ("incline-db", "Incline Dumbbell Press", "dumbbell", "chest", "weight", 8, 12, 2, False),
    ("ohp", "Overhead Press", "barbell", "shoulders", "weight", 6, 10, 2.5, False),
    ("lateral", "Lateral Raise", "dumbbell", "shoulders", "weight", 12, 15, 1, False),
    ("pushdown", "Triceps Pushdown", "cable", "triceps", "weight", 10, 15, 2.5, False),
    ("row", "Barbell Row", "barbell", "back", "weight", 6, 10, 2.5, False),
    ("pulldown", "Lat Pulldown", "cable", "back", "weight", 8, 12, 2.5, False),
    ("pullup", "Pull-up", "bodyweight", "back", "bodyweight", 5, 10, 2.5, False),
    ("facepull", "Face Pull", "cable", "shoulders", "weight", 12, 15, 2.5, False),
    ("curl", "Dumbbell Curl", "dumbbell", "biceps", "weight", 8, 12, 1, False),
    ("squat", "Back Squat", "barbell", "quads", "weight", 5, 8, 2.5, False),
    ("rdl", "Romanian Deadlift", "barbell", "hamstrings", "weight", 6, 10, 2.5, False),
    ("legpress", "Leg Press", "machine", "quads", "weight", 10, 15, 5, False),
    ("plank", "Plank", "bodyweight", "core", "time", 30, 60, 0, True),
)  # fmt: skip
SPLIT: tuple[tuple[str, str, tuple[str, ...]], ...] = (
    ("push-a", "Push A", ("bench", "ohp", "incline-db", "lateral", "pushdown")),
    ("pull-a", "Pull A", ("row", "pulldown", "pullup", "facepull", "curl")),
    ("legs-a", "Legs A", ("squat", "rdl", "legpress")),
)


def library_exercise_id(ctx: Ctx, key: str) -> uuid.UUID:
    return derived_id("exercise", ctx.user_id, key)


def _seed_library(ctx: Ctx) -> None:
    for key, name, equip, muscle, load, rmin, rmax, inc, archived in LIBRARY:
        owned_repo.upsert(
            ctx,
            Exercise,
            library_exercise_id(ctx, key),
            {
                "name": name,
                "equipment": equip,
                "muscle": muscle,
                "load_type": load,
                "rep_min": rmin,
                "rep_max": rmax,
                "increment": inc,
                "archived": archived,
            },
        )
    for order, (key, name, keys) in enumerate(SPLIT):
        _put_template(
            ctx,
            derived_id("template", ctx.user_id, key),
            name,
            [(library_exercise_id(ctx, k), DEFAULT_SETS) for k in keys],
            sort_order=order,
        )


def ensure_settings(ctx: Ctx) -> FitnessSettings:
    """The caller's settings row, created (with the seeded exercise library
    and split) on first access. Flushes only."""
    row = repo.get_settings(ctx)
    if row is not None and row.deleted_at is None:
        return row
    if row is None:
        never_used = owned_repo.find_one(ctx, Exercise, include_deleted=True) is None
        row = owned_repo.insert(ctx, FitnessSettings, {})
        if never_used:
            _seed_library(ctx)
        return row
    owned_repo.restore(ctx, row)
    return row


def get_settings(*, ctx: Ctx) -> FitnessSettings:
    row = ensure_settings(ctx)
    ctx.commit()
    return row


def update_settings(*, ctx: Ctx, patch: dict[str, Any]) -> FitnessSettings:
    row = ensure_settings(ctx)
    owned_repo.apply(row, patch)
    ctx.session.add(row)
    ctx.session.flush()
    _dirty(ctx, ctx.today)
    ctx.commit()
    return row


# --------------------------------------------------------------------------
# Workouts: lookups
# --------------------------------------------------------------------------


def _workout(ctx: Ctx, workout_id: uuid.UUID) -> Workout:
    return owned_repo.require(ctx, Workout, workout_id, what="workout")


def _we(ctx: Ctx, workout_id: uuid.UUID, we_id: uuid.UUID) -> WorkoutExercise:
    _workout(ctx, workout_id)
    we = owned_repo.require(ctx, WorkoutExercise, we_id, what="workout_exercise")
    if we.workout_id != workout_id:
        raise not_found("workout_exercise")
    return we


def _set(
    ctx: Ctx, workout_id: uuid.UUID, we_id: uuid.UUID, set_id: uuid.UUID
) -> WorkoutSet:
    _we(ctx, workout_id, we_id)
    st = owned_repo.require(ctx, WorkoutSet, set_id, what="workout_set")
    if st.workout_exercise_id != we_id:
        raise not_found("workout_set")
    return st


def _exercise(ctx: Ctx, exercise_id: uuid.UUID) -> Exercise:
    return owned_repo.require(ctx, Exercise, exercise_id, what="exercise")


def live_label(ctx: Ctx, w: Workout) -> str:
    wes = repo.workout_exercises(ctx, w.id)
    sets = [s for ss in repo.sets_of(ctx, [we.id for we in wes]).values() for s in ss]
    working = [s for s in sets if s.kind != "warmup"]
    done = sum(1 for s in working if s.completed_at is not None)
    return f"{w.name} · {done}/{len(working)} sets"


def _relabel(ctx: Ctx, workout_id: uuid.UUID) -> None:
    """Keep the Live bar's "n/m sets" current as sets change."""
    w = owned_repo.get(ctx, Workout, workout_id)
    if w is not None and w.status == "in_progress":
        profile_public.update_live_label(
            ctx, kind="workout", ref_id=w.id, label=live_label(ctx, w)
        )


# --------------------------------------------------------------------------
# Planned sets (``plannedSets``)
# --------------------------------------------------------------------------


@dataclass(frozen=True)
class PlannedSet:
    reps: int
    weight: float
    kind: str


def planned_sets(state: C.FitState, exercise_id: str, count: int) -> list[PlannedSet]:
    """Prefill from the last session of the lift: its warm-ups, then
    ``count`` working sets at the overload suggestion (or last time's
    weight with the suggested reps). A first-time lift gets one blank set."""
    ex = next((e for e in state.exercises if e.id == exercise_id), None)
    hist = C.exercise_history(state, exercise_id)
    if ex is None or not hist:
        return [PlannedSet(ex.rep_min if ex else 8, 0, "working")]
    last = hist[-1]
    sug = C.suggestion(state, exercise_id)
    warm = [
        PlannedSet(x.reps, x.weight, x.kind) for x in last.we.sets if x.kind == "warmup"
    ]
    work = [x for x in last.we.sets if C.is_working(x) and C.is_done(x)]
    out: list[PlannedSet] = []
    for i in range(max(count, 1)):
        prev = work[min(i, len(work) - 1)]
        if sug.kind == "weight":
            out.append(PlannedSet(sug.reps, sug.weight, "working"))
        else:
            out.append(
                PlannedSet(
                    min(ex.rep_max, max(prev.reps, sug.reps)), prev.weight, "working"
                )
            )
    return warm + out


def _insert_planned(
    ctx: Ctx,
    state: C.FitState,
    we: WorkoutExercise,
    count: int,
) -> list[WorkoutSet]:
    start = repo.next_position(
        ctx, WorkoutSet, col(WorkoutSet.workout_exercise_id), we.id
    )
    rows = []
    for i, p in enumerate(planned_sets(state, str(we.exercise_id), count)):
        pos = start + i
        rows.append(
            owned_repo.insert(
                ctx,
                WorkoutSet,
                {
                    "workout_exercise_id": we.id,
                    "position": pos,
                    "reps": p.reps,
                    "weight": p.weight,
                    "kind": p.kind,
                },
                row_id=derived_id("workout-set", we.id, str(pos)),
            )
        )
    return rows


def _add_exercise(
    ctx: Ctx,
    state: C.FitState,
    w: Workout,
    exercise_id: uuid.UUID,
    sets: int,
    *,
    we_id: uuid.UUID | None = None,
) -> WorkoutExercise:
    _exercise(ctx, exercise_id)
    pos = repo.next_position(
        ctx, WorkoutExercise, col(WorkoutExercise.workout_id), w.id
    )
    we = owned_repo.insert(
        ctx,
        WorkoutExercise,
        {"workout_id": w.id, "exercise_id": exercise_id, "position": pos},
        row_id=we_id or derived_id("workout-exercise", w.id, str(pos)),
    )
    _insert_planned(ctx, state, we, sets)
    return we


def _working_count(ctx: Ctx, we_id: uuid.UUID) -> int:
    return sum(
        1 for s in repo.sets_of(ctx, [we_id]).get(we_id, []) if s.kind != "warmup"
    )


# --------------------------------------------------------------------------
# Start / finish / discard / delete / restore
# --------------------------------------------------------------------------

StartSource = Literal["empty", "template", "repeat"]


def _empty_name(ctx: Ctx) -> str:
    h = ctx.now.astimezone(ctx.clock.zone).hour
    if h < 12:
        return "Morning workout"
    return "Afternoon workout" if h < 17 else "Evening workout"


def start_workout(
    *,
    ctx: Ctx,
    source: StartSource = "empty",
    template_id: uuid.UUID | None = None,
    from_workout_id: uuid.UUID | None = None,
    workout_id: uuid.UUID | None = None,
) -> tuple[Workout, bool]:
    """Start a workout from nothing, a template, or a past workout.

    Returns ``(workout, resumed)``: while a workout is in progress the call
    returns that one (one active workout, enforced by a partial unique
    index). Claiming the Live bar fails with 409 ``live_session_busy`` when
    a habit timer or routine is running.
    """
    active = repo.active_workout(ctx)
    if active is not None:
        return active, True
    if workout_id is not None:
        existing = owned_repo.get(ctx, Workout, workout_id, include_deleted=True)
        if existing is not None:
            if existing.deleted_at is not None:
                raise conflict("workout_deleted", "This workout was deleted")
            return existing, True
    ensure_settings(ctx)
    name = _empty_name(ctx)
    tid: uuid.UUID | None = None
    items: list[tuple[uuid.UUID, int]] = []
    if source == "template":
        if template_id is None:
            raise invalid("template_required", "Pick a template to start from")
        t = owned_repo.require(ctx, WorkoutTemplate, template_id, what="template")
        name, tid = t.name, t.id
        items = [(i.exercise_id, i.sets) for i in repo.template_items(ctx, t.id)]
    elif source == "repeat":
        if from_workout_id is None:
            raise invalid("workout_required", "Pick a workout to repeat")
        src = _workout(ctx, from_workout_id)
        name, tid = src.name, src.template_id
        items = [
            (we.exercise_id, _working_count(ctx, we.id) or DEFAULT_SETS)
            for we in repo.workout_exercises(ctx, src.id)
        ]
    wid = workout_id or uuid.uuid4()
    state = repo.load_state(ctx, meals=False)
    working = sum(
        sum(1 for p in planned_sets(state, str(ex_id), n) if p.kind != "warmup")
        for ex_id, n in items
    )
    profile_public.start_live(
        ctx,
        kind="workout",
        label=f"{name} · 0/{working} sets",
        href=WORKOUT_HREF,
        ref_id=wid,
    )
    w = _insert_active(ctx, wid, name=name, template_id=tid)
    for ex_id, n in items:
        _add_exercise(ctx, state, w, ex_id, n)
    _clear_rest(ctx)
    _dirty_at(ctx, w.started_at)
    ctx.commit()
    return w, False


def _insert_active(
    ctx: Ctx, wid: uuid.UUID, *, name: str, template_id: uuid.UUID | None
) -> Workout:
    try:
        with ctx.session.begin_nested():
            return owned_repo.insert(
                ctx,
                Workout,
                {
                    "name": name,
                    "template_id": template_id,
                    "started_at": ctx.now,
                    "status": "in_progress",
                    "source": "live",
                },
                row_id=wid,
            )
    except IntegrityError:
        if repo.active_workout(ctx) is None:
            raise
        # Lost a race with another device starting one at the same moment.
        raise conflict(
            "workout_in_progress", "Another workout is already in progress"
        ) from None


def _finish_tail(ctx: Ctx, w: Workout) -> None:
    """What every finished workout does, live or logged from chat."""
    profile_public.end_live(ctx, kind="workout", ref_id=w.id)
    day = ctx.clock.day_of(w.started_at)
    _dirty(ctx, day)
    habits_public.auto_check_workout_habits(ctx, day=day, workout_id=w.id)


def finish_workout(
    *,
    ctx: Ctx,
    workout_id: uuid.UUID,
    unfinished: Literal["remove", "done"] = "remove",
    end_at: datetime | None = None,
) -> Workout:
    """End a workout. Unchecked sets are removed (or marked done at the end
    time); exercises left without sets go too. Releases the Live bar and
    ticks the habits linked to workouts."""
    w = _workout(ctx, workout_id)
    if w.status == "finished":
        return w
    ended_at = end_at or ctx.now
    if ended_at < w.started_at:
        raise invalid("end_before_start", "A workout cannot end before it started")
    wes = repo.workout_exercises(ctx, w.id)
    sets = repo.sets_of(ctx, [we.id for we in wes])
    for we in wes:
        kept = 0
        for s in sets.get(we.id, []):
            if s.completed_at is not None:
                kept += 1
            elif unfinished == "done":
                s.completed_at = ended_at
                ctx.session.add(s)
                kept += 1
            else:
                owned_repo.soft_delete(ctx, s)
        if not kept:
            owned_repo.soft_delete(ctx, we)
    w.status = "finished"
    w.ended_at = ended_at
    ctx.session.add(w)
    ctx.session.flush()
    _clear_rest(ctx)
    _finish_tail(ctx, w)
    ctx.commit()
    return w


def discard_workout(*, ctx: Ctx, workout_id: uuid.UUID) -> None:
    w = _workout(ctx, workout_id)
    if w.status != "in_progress":
        raise conflict(
            "workout_not_active", "Only a workout in progress can be discarded"
        )
    w.status = "discarded"
    w.ended_at = ctx.now
    owned_repo.soft_delete(ctx, w)
    profile_public.end_live(ctx, kind="workout", ref_id=w.id)
    _clear_rest(ctx)
    _dirty_at(ctx, w.started_at)
    ctx.commit()


def delete_workout(*, ctx: Ctx, workout_id: uuid.UUID) -> None:
    w = _workout(ctx, workout_id)
    if w.status == "in_progress":
        discard_workout(ctx=ctx, workout_id=workout_id)
        return
    _delete_workout(ctx, w)
    ctx.commit()


def _delete_workout(ctx: Ctx, w: Workout) -> None:
    owned_repo.soft_delete(ctx, w)
    _dirty_at(ctx, w.started_at)


def restore_workout(*, ctx: Ctx, workout_id: uuid.UUID) -> Workout:
    w = owned_repo.require(
        ctx, Workout, workout_id, what="workout", include_deleted=True
    )
    if w.deleted_at is None:
        return w
    if w.status != "finished":
        raise conflict(
            "workout_not_restorable", "A discarded workout cannot be restored"
        )
    owned_repo.restore(ctx, w)
    _dirty_at(ctx, w.started_at)
    ctx.commit()
    return w


def log_workout_from_chat(
    ctx: Ctx,
    *,
    name: str,
    exercises: list[tuple[str, list[tuple[int, float]]]],
    day: date | None = None,
    workout_id: uuid.UUID | None = None,
    cardio: dict[str, object] | None = None,
) -> Workout:
    """A finished workout backfilled from a capture (``logWorkoutFromChat``):
    18:30 on the day, one hour long, unknown exercises created. Flushes only;
    runs the same finish tail as the live logger."""
    if workout_id is not None:
        existing = owned_repo.get(ctx, Workout, workout_id)
        if existing is not None:
            return existing
    ensure_settings(ctx)
    start = ctx.clock.local_time(day or ctx.today, "18:30")
    w = owned_repo.insert(
        ctx,
        Workout,
        {
            "name": name,
            "started_at": start,
            "ended_at": start + timedelta(minutes=60),
            "status": "finished",
            "source": "chat",
            "cardio": cardio,
        },
        row_id=workout_id,
    )
    for pos, (ex_name, sets) in enumerate(exercises):
        ex = find_or_create_exercise(ctx, ex_name)
        we = owned_repo.insert(
            ctx,
            WorkoutExercise,
            {"workout_id": w.id, "exercise_id": ex.id, "position": pos},
            row_id=derived_id("workout-exercise", w.id, str(pos)),
        )
        for i, (reps, weight) in enumerate(sets):
            owned_repo.insert(
                ctx,
                WorkoutSet,
                {
                    "workout_exercise_id": we.id,
                    "position": i,
                    "reps": reps,
                    "weight": weight,
                    "kind": "working",
                    "completed_at": start,
                },
                row_id=derived_id("workout-set", we.id, str(i)),
            )
    _finish_tail(ctx, w)
    return w


def find_or_create_exercise(ctx: Ctx, name: str) -> Exercise:
    """A live exercise with this name (case-insensitive), else a new one
    with the default shape. The new id is derived from the name, so a
    replayed capture does not create it twice."""
    clean = name.strip()
    if not clean:
        raise invalid("exercise_name_required", "An exercise needs a name")
    ensure_settings(ctx)
    for e in owned_repo.list_rows(ctx, Exercise):
        if e.name.lower() == clean.lower():
            return e
    ex, _ = owned_repo.upsert(
        ctx,
        Exercise,
        derived_id("exercise", ctx.user_id, "name:" + clean.lower()),
        # ``upsertExercise({name})`` defaults: a barbell chest lift, 8-12.
        {"name": clean[:80], "equipment": "barbell", "muscle": "chest"},
    )
    return ex


# --------------------------------------------------------------------------
# Editing a workout
# --------------------------------------------------------------------------


def update_workout_meta(
    *, ctx: Ctx, workout_id: uuid.UUID, patch: dict[str, Any]
) -> Workout:
    w = _workout(ctx, workout_id)
    owned_repo.apply(w, patch)
    ctx.session.add(w)
    ctx.session.flush()
    ctx.commit()
    return w


def add_exercises(
    *,
    ctx: Ctx,
    workout_id: uuid.UUID,
    exercise_ids: list[uuid.UUID],
    ids: list[uuid.UUID] | None = None,
) -> list[WorkoutExercise]:
    w = _workout(ctx, workout_id)
    if ids is not None and len(ids) != len(exercise_ids):
        raise invalid("ids_mismatch", "Give one id per exercise")
    state = repo.load_state(ctx, meals=False)
    out = [
        _add_exercise(ctx, state, w, ex_id, DEFAULT_SETS, we_id=ids[i] if ids else None)
        for i, ex_id in enumerate(exercise_ids)
    ]
    _dirty_at(ctx, w.started_at)
    _relabel(ctx, workout_id)
    ctx.commit()
    return out


def remove_exercise(*, ctx: Ctx, workout_id: uuid.UUID, we_id: uuid.UUID) -> None:
    we = _we(ctx, workout_id, we_id)
    for s in repo.sets_of(ctx, [we.id]).get(we.id, []):
        owned_repo.soft_delete(ctx, s)
    owned_repo.soft_delete(ctx, we)
    _dirty_at(ctx, _workout(ctx, workout_id).started_at)
    _relabel(ctx, workout_id)
    ctx.commit()


def move_exercise(
    *, ctx: Ctx, workout_id: uuid.UUID, we_id: uuid.UUID, dir: Literal[-1, 1]
) -> list[WorkoutExercise]:
    """Swap with the live neighbour above (-1) or below (+1); a move past
    either end is a no-op."""
    _we(ctx, workout_id, we_id)
    wes = repo.workout_exercises(ctx, workout_id)
    i = next(k for k, we in enumerate(wes) if we.id == we_id)
    j = i + dir
    if 0 <= j < len(wes):
        a, b = wes[i], wes[j]
        pa, pb = a.position, b.position
        # The (workout, position) index is checked per statement: park one
        # row on a free slot first, flushing between the writes.
        a.position = -1
        ctx.session.add(a)
        ctx.session.flush()
        b.position = pa
        ctx.session.add(b)
        ctx.session.flush()
        a.position = pb
        ctx.session.add(a)
        ctx.session.flush()
    ctx.commit()
    return repo.workout_exercises(ctx, workout_id)


def replace_exercise(
    *, ctx: Ctx, workout_id: uuid.UUID, we_id: uuid.UUID, exercise_id: uuid.UUID
) -> WorkoutExercise:
    """Swap the lift; its sets are re-planned from the new lift's history,
    keeping the number of working sets."""
    we = _we(ctx, workout_id, we_id)
    _exercise(ctx, exercise_id)
    count = _working_count(ctx, we.id) or DEFAULT_SETS
    for s in repo.sets_of(ctx, [we.id]).get(we.id, []):
        owned_repo.soft_delete(ctx, s)
    we.exercise_id = exercise_id
    ctx.session.add(we)
    ctx.session.flush()
    _insert_planned(ctx, repo.load_state(ctx, meals=False), we, count)
    _dirty_at(ctx, _workout(ctx, workout_id).started_at)
    ctx.commit()
    return we


def set_exercise_note(
    *, ctx: Ctx, workout_id: uuid.UUID, we_id: uuid.UUID, note: str
) -> WorkoutExercise:
    we = _we(ctx, workout_id, we_id)
    we.note = note or None
    ctx.session.add(we)
    ctx.session.flush()
    ctx.commit()
    return we


def toggle_set(
    *, ctx: Ctx, workout_id: uuid.UUID, we_id: uuid.UUID, set_id: uuid.UUID
) -> tuple[WorkoutSet, bool, RestTimer | None]:
    """Tick or untick a set. Ticking a set of the workout in progress starts
    the rest timer at the default rest."""
    st = _set(ctx, workout_id, we_id, set_id)
    completed = st.completed_at is None
    st.completed_at = ctx.now if completed else None
    ctx.session.add(st)
    ctx.session.flush()
    w = _workout(ctx, workout_id)
    rest: RestTimer | None = None
    if completed and w.status == "in_progress":
        rest = _start_rest(ctx, None)
    _dirty_at(ctx, w.started_at)
    _relabel(ctx, workout_id)
    ctx.commit()
    return st, completed, rest


def update_set(
    *,
    ctx: Ctx,
    workout_id: uuid.UUID,
    we_id: uuid.UUID,
    set_id: uuid.UUID,
    patch: dict[str, Any],
) -> WorkoutSet:
    st = _set(ctx, workout_id, we_id, set_id)
    owned_repo.apply(st, patch)
    ctx.session.add(st)
    ctx.session.flush()
    _dirty_at(ctx, _workout(ctx, workout_id).started_at)
    ctx.commit()
    return st


def add_set(
    *,
    ctx: Ctx,
    workout_id: uuid.UUID,
    we_id: uuid.UUID,
    set_id: uuid.UUID | None = None,
) -> WorkoutSet:
    """Append a working set copying the last working set (8 × 0 when none)."""
    we = _we(ctx, workout_id, we_id)
    working = [
        s for s in repo.sets_of(ctx, [we.id]).get(we.id, []) if s.kind != "warmup"
    ]
    last = working[-1] if working else None
    pos = repo.next_position(
        ctx, WorkoutSet, col(WorkoutSet.workout_exercise_id), we.id
    )
    st = owned_repo.insert(
        ctx,
        WorkoutSet,
        {
            "workout_exercise_id": we.id,
            "position": pos,
            "reps": last.reps if last else 8,
            "weight": last.weight if last else 0,
            "kind": "working",
        },
        row_id=set_id or derived_id("workout-set", we.id, str(pos)),
    )
    _relabel(ctx, workout_id)
    ctx.commit()
    return st


def remove_set(
    *, ctx: Ctx, workout_id: uuid.UUID, we_id: uuid.UUID, set_id: uuid.UUID
) -> None:
    st = _set(ctx, workout_id, we_id, set_id)
    owned_repo.soft_delete(ctx, st)
    _dirty_at(ctx, _workout(ctx, workout_id).started_at)
    _relabel(ctx, workout_id)
    ctx.commit()


# --------------------------------------------------------------------------
# Rest timer
# --------------------------------------------------------------------------


def _start_rest(ctx: Ctx, sec: int | None) -> RestTimer:
    d = sec if sec is not None else ensure_settings(ctx).rest_sec
    data = {"duration_sec": d, "ends_at": ctx.now + timedelta(seconds=d)}
    row = repo.rest_timer(ctx)
    if row is None:
        return owned_repo.insert(ctx, RestTimer, data)
    owned_repo.apply(row, data)
    row.deleted_at = None
    ctx.session.add(row)
    ctx.session.flush()
    return row


def _clear_rest(ctx: Ctx) -> None:
    row = repo.rest_timer(ctx)
    if row is not None and row.deleted_at is None:
        owned_repo.soft_delete(ctx, row)


def get_rest(ctx: Ctx) -> RestTimer | None:
    row = repo.rest_timer(ctx)
    return row if row is not None and row.deleted_at is None else None


def start_rest(*, ctx: Ctx, sec: int | None = None) -> RestTimer:
    row = _start_rest(ctx, sec)
    ctx.commit()
    return row


def adjust_rest(*, ctx: Ctx, delta: int) -> RestTimer | None:
    """Add (or take) seconds; no timer running is a no-op."""
    row = get_rest(ctx)
    if row is not None:
        row.duration_sec = max(0, row.duration_sec + delta)
        row.ends_at = row.ends_at + timedelta(seconds=delta)
        ctx.session.add(row)
        ctx.session.flush()
    ctx.commit()
    return row


def skip_rest(*, ctx: Ctx) -> None:
    _clear_rest(ctx)
    ctx.commit()


# --------------------------------------------------------------------------
# Templates
# --------------------------------------------------------------------------


def _put_template(
    ctx: Ctx,
    template_id: uuid.UUID,
    name: str,
    items: list[tuple[uuid.UUID, int]],
    *,
    sort_order: int | None = None,
) -> WorkoutTemplate:
    existing = owned_repo.get(ctx, WorkoutTemplate, template_id, include_deleted=True)
    data: dict[str, Any] = {"name": name}
    if sort_order is not None:
        data["sort_order"] = sort_order
    elif existing is None:
        data["sort_order"] = (
            max(
                (t.sort_order for t in owned_repo.list_rows(ctx, WorkoutTemplate)),
                default=-1,
            )
            + 1
        )
    t, _ = owned_repo.upsert(ctx, WorkoutTemplate, template_id, data)
    # Items are slots by position: rewrite slot i, tombstone the rest.
    for pos, (ex_id, sets) in enumerate(items):
        owned_repo.upsert(
            ctx,
            TemplateItem,
            derived_id("template-item", t.id, str(pos)),
            {"template_id": t.id, "exercise_id": ex_id, "position": pos, "sets": sets},
            natural_key=("template_id", "position"),
        )
    for it in repo.template_items(ctx, t.id):
        if it.position >= len(items):
            owned_repo.soft_delete(ctx, it)
    return t


def upsert_template(
    *,
    ctx: Ctx,
    name: str,
    items: list[tuple[uuid.UUID, int]],
    template_id: uuid.UUID | None = None,
) -> WorkoutTemplate:
    for ex_id, _ in items:
        _exercise(ctx, ex_id)
    t = _put_template(ctx, template_id or uuid.uuid4(), name, items)
    ctx.commit()
    return t


def save_as_template(
    *,
    ctx: Ctx,
    workout_id: uuid.UUID,
    name: str | None = None,
    template_id: uuid.UUID | None = None,
) -> WorkoutTemplate:
    w = _workout(ctx, workout_id)
    items = [
        (we.exercise_id, _working_count(ctx, we.id) or DEFAULT_SETS)
        for we in repo.workout_exercises(ctx, w.id)
    ]
    t = _put_template(
        ctx, template_id or uuid.uuid4(), name or f"{w.name} (copy)", items
    )
    ctx.commit()
    return t


def _delete_template(ctx: Ctx, template_id: uuid.UUID) -> None:
    t = owned_repo.require(ctx, WorkoutTemplate, template_id, what="template")
    for it in repo.template_items(ctx, t.id):
        owned_repo.soft_delete(ctx, it)
    owned_repo.soft_delete(ctx, t)


def delete_template(*, ctx: Ctx, template_id: uuid.UUID) -> None:
    _delete_template(ctx, template_id)
    ctx.commit()


def restore_template(*, ctx: Ctx, template_id: uuid.UUID) -> WorkoutTemplate:
    t = owned_repo.require(
        ctx, WorkoutTemplate, template_id, what="template", include_deleted=True
    )
    if t.deleted_at is not None:
        # The items the template's delete took with it share its timestamp.
        gone_at = t.deleted_at
        owned_repo.restore(ctx, t)
        for it in owned_repo.list_rows(
            ctx,
            TemplateItem,
            col(TemplateItem.template_id) == t.id,
            col(TemplateItem.deleted_at) == gone_at,
            include_deleted=True,
        ):
            owned_repo.restore(ctx, it)
    ctx.commit()
    return t


# --------------------------------------------------------------------------
# Exercises
# --------------------------------------------------------------------------


def upsert_exercise(
    *, ctx: Ctx, data: dict[str, Any], exercise_id: uuid.UUID | None = None
) -> Exercise:
    data = {**data, "name": str(data["name"]).strip()}
    if not data["name"]:
        raise invalid("exercise_name_required", "An exercise needs a name")
    if data["rep_max"] < data["rep_min"]:
        raise invalid("invalid_rep_range", "The rep range ends before it starts")
    ex, _ = owned_repo.upsert(ctx, Exercise, exercise_id or uuid.uuid4(), data)
    ctx.commit()
    return ex


def set_exercise_archived(
    *, ctx: Ctx, exercise_id: uuid.UUID, archived: bool
) -> Exercise:
    ex = _exercise(ctx, exercise_id)
    ex.archived = archived
    ctx.session.add(ex)
    ctx.session.flush()
    ctx.commit()
    return ex


# --------------------------------------------------------------------------
# Weigh-ins
# --------------------------------------------------------------------------


def _round1(n: float) -> float:
    return C.js_round(n * 10) / 10


def _weigh_in(
    ctx: Ctx,
    *,
    kg: float,
    at: datetime | None,
    body_fat_pct: float | None = None,
    note: str | None = None,
    weigh_in_id: uuid.UUID | None = None,
) -> WeighIn:
    if weigh_in_id is not None:
        existing = owned_repo.get(ctx, WeighIn, weigh_in_id)
        if existing is not None:
            return existing
    w = owned_repo.insert(
        ctx,
        WeighIn,
        {
            "weight_kg": _round1(kg),
            "measured_at": at or ctx.now,
            "body_fat_pct": _round1(body_fat_pct) if body_fat_pct is not None else None,
            "note": note,
        },
        row_id=weigh_in_id,
    )
    _dirty_at(ctx, w.measured_at)
    return w


def log_weigh_in(
    *,
    ctx: Ctx,
    kg: float,
    at: datetime | None = None,
    body_fat_pct: float | None = None,
    note: str | None = None,
    weigh_in_id: uuid.UUID | None = None,
) -> WeighIn:
    w = _weigh_in(
        ctx, kg=kg, at=at, body_fat_pct=body_fat_pct, note=note, weigh_in_id=weigh_in_id
    )
    ctx.commit()
    return w


def update_weigh_in(
    *, ctx: Ctx, weigh_in_id: uuid.UUID, patch: dict[str, Any]
) -> WeighIn:
    w = owned_repo.require(ctx, WeighIn, weigh_in_id, what="weigh_in")
    before = w.measured_at
    owned_repo.apply(w, patch)
    ctx.session.add(w)
    ctx.session.flush()
    _dirty_at(ctx, before)
    _dirty_at(ctx, w.measured_at)
    ctx.commit()
    return w


def _delete_weigh_in(ctx: Ctx, weigh_in_id: uuid.UUID) -> None:
    w = owned_repo.require(ctx, WeighIn, weigh_in_id, what="weigh_in")
    owned_repo.soft_delete(ctx, w)
    _dirty_at(ctx, w.measured_at)


def delete_weigh_in(*, ctx: Ctx, weigh_in_id: uuid.UUID) -> None:
    _delete_weigh_in(ctx, weigh_in_id)
    ctx.commit()


def restore_weigh_in(*, ctx: Ctx, weigh_in_id: uuid.UUID) -> WeighIn:
    w = owned_repo.require(
        ctx, WeighIn, weigh_in_id, what="weigh_in", include_deleted=True
    )
    owned_repo.restore(ctx, w)
    _dirty_at(ctx, w.measured_at)
    ctx.commit()
    return w


# --------------------------------------------------------------------------
# Meals
# --------------------------------------------------------------------------


def _meal(ctx: Ctx, meal_id: uuid.UUID) -> Meal:
    return owned_repo.require(ctx, Meal, meal_id, what="meal")


def _item(ctx: Ctx, meal_id: uuid.UUID, item_id: uuid.UUID) -> MealItem:
    _meal(ctx, meal_id)
    it = owned_repo.require(ctx, MealItem, item_id, what="meal_item")
    if it.meal_id != meal_id:
        raise not_found("meal_item")
    return it


def _item_data(d: F.ItemDraft) -> dict[str, Any]:
    return {
        "name": d.name[:120],
        "qty": d.qty,
        "unit": d.unit[:24],
        "kcal": d.kcal,
        "protein": d.protein,
        "carbs": d.carbs,
        "fat": d.fat,
        "assumption": d.assumption,
        "fiber": d.fiber,
        "sat_fat": d.sat_fat,
        "sugar": d.sugar,
        "sodium": d.sodium,
    }


def _replace_items(
    ctx: Ctx,
    meal: Meal,
    drafts: list[F.ItemDraft],
    ids: list[uuid.UUID | None] | None = None,
) -> list[MealItem]:
    for old in repo.meal_items(ctx, meal.id):
        owned_repo.soft_delete(ctx, old)
    return _append_items(ctx, meal, drafts, ids)


def _append_items(
    ctx: Ctx,
    meal: Meal,
    drafts: list[F.ItemDraft],
    ids: list[uuid.UUID | None] | None = None,
) -> list[MealItem]:
    start = repo.next_position(ctx, MealItem, col(MealItem.meal_id), meal.id)
    out = []
    for i, d in enumerate(drafts):
        pos = start + i
        given = ids[i] if ids else None
        out.append(
            owned_repo.insert(
                ctx,
                MealItem,
                {**_item_data(d), "meal_id": meal.id, "position": pos},
                row_id=given or derived_id("meal-item", meal.id, str(pos)),
            )
        )
    return out


def _new_meal(
    ctx: Ctx,
    *,
    eaten_at: datetime | None,
    label: str | None,
    source: str,
    raw_input: str,
    status: str,
    confidence: float | None = None,
    follow_up: dict[str, object] | None = None,
    photo_media_id: uuid.UUID | None = None,
    meal_id: uuid.UUID | None = None,
) -> Meal:
    at = eaten_at or ctx.now
    m = owned_repo.insert(
        ctx,
        Meal,
        {
            "eaten_at": at,
            "label": label or C.label_for_time(at, ctx.clock),
            "source": source,
            "raw_input": raw_input[:2000],
            "status": status,
            "confidence": confidence,
            "follow_up": follow_up,
            "photo_media_id": photo_media_id,
        },
        row_id=meal_id,
    )
    _dirty_at(ctx, at)
    return m


def _existing_meal(ctx: Ctx, meal_id: uuid.UUID | None) -> Meal | None:
    if meal_id is None:
        return None
    m = owned_repo.get(ctx, Meal, meal_id, include_deleted=True)
    if m is not None and m.deleted_at is not None:
        raise conflict("meal_deleted", "This meal was deleted")
    return m


def log_meal(
    *,
    ctx: Ctx,
    items: list[F.ItemDraft],
    eaten_at: datetime | None = None,
    label: str | None = None,
    source: str = "manual",
    raw_input: str | None = None,
    meal_id: uuid.UUID | None = None,
    item_ids: list[uuid.UUID | None] | None = None,
) -> Meal:
    """A meal entered by hand: confirmed as logged."""
    existing = _existing_meal(ctx, meal_id)
    if existing is not None:
        return existing
    m = _new_meal(
        ctx,
        eaten_at=eaten_at,
        label=label,
        source=source,
        raw_input=raw_input
        if raw_input is not None
        else ", ".join(i.name for i in items),
        status="confirmed",
        meal_id=meal_id,
    )
    _append_items(ctx, m, items, item_ids)
    ctx.commit()
    return m


def _confidence(est: F.Estimate, photo: bool) -> float:
    return est.confidence - 0.08 if photo else est.confidence


def estimate_meal(
    *,
    ctx: Ctx,
    text: str,
    eaten_at: datetime | None = None,
    label: str | None = None,
    source: str = "text",
    meal_id: uuid.UUID | None = None,
) -> Meal:
    """Estimate a described meal with the built-in food table; the meal
    waits in ``estimated`` for the user to confirm it."""
    existing = _existing_meal(ctx, meal_id)
    if existing is not None:
        return existing
    est = F.parse_meal_text(text)
    if est is None:
        raise invalid(
            "meal_not_recognised",
            "Couldn't estimate that meal — describe it differently or enter macros",
        )
    m = _new_meal(
        ctx,
        eaten_at=eaten_at,
        label=label,
        source=source,
        raw_input=text,
        status="estimated",
        confidence=_confidence(est, source == "photo"),
        follow_up=est.follow_up.as_dict() if est.follow_up else None,
        meal_id=meal_id,
    )
    _append_items(ctx, m, est.items)
    ctx.commit()
    return m


def queue_meal_photo(
    *,
    ctx: Ctx,
    hint: str = "",
    eaten_at: datetime | None = None,
    photo_media_id: uuid.UUID | None = None,
    meal_id: uuid.UUID | None = None,
) -> Meal:
    """A photo waiting for its estimate (``pending_estimate``). It counts as
    a logged meal but adds no macros until the estimate fills its items."""
    existing = _existing_meal(ctx, meal_id)
    if existing is not None:
        return existing
    if photo_media_id is not None:
        media_public.require_ready(ctx, photo_media_id)
    m = _new_meal(
        ctx,
        eaten_at=eaten_at,
        label=None,
        source="photo",
        raw_input=f"Photo · “{hint}”" if hint else "Photo",
        status="pending_estimate",
        photo_media_id=photo_media_id,
        meal_id=meal_id,
    )
    ctx.commit()
    return m


def apply_estimate(
    ctx: Ctx,
    meal: Meal,
    items: list[F.ItemDraft],
    confidence: float,
    follow_up: dict[str, object] | None,
    *,
    raw_input: str | None = None,
) -> Meal:
    """Fill a meal's items from an estimate. Flushes only."""
    if meal.status == "confirmed":
        raise conflict("meal_confirmed", "This meal is already confirmed")
    _replace_items(ctx, meal, items)
    meal.status = "estimated"
    meal.confidence = max(0.0, min(1.0, confidence))
    meal.follow_up = follow_up
    if raw_input is not None:
        meal.raw_input = raw_input[:2000]
    ctx.session.add(meal)
    ctx.session.flush()
    _dirty_at(ctx, meal.eaten_at)
    return meal


def reestimate_meal(*, ctx: Ctx, meal_id: uuid.UUID, hint: str | None = None) -> Meal:
    """Run the built-in estimator over the meal's description (or a hint the
    user added). A pending photo with nothing readable stays pending."""
    m = _meal(ctx, meal_id)
    est = F.parse_meal_text(hint if hint is not None else m.raw_input)
    if est is None:
        raise invalid(
            "meal_not_recognised",
            "Couldn't estimate that meal — describe it differently or enter macros",
        )
    if m.status == "confirmed":
        m.status = "estimated"
    apply_estimate(
        ctx,
        m,
        est.items,
        est.confidence,
        est.follow_up.as_dict() if est.follow_up else None,
        raw_input=f"{m.raw_input} · “{hint}”" if hint is not None else None,
    )
    ctx.commit()
    return m


def update_meal(*, ctx: Ctx, meal_id: uuid.UUID, patch: dict[str, Any]) -> Meal:
    m = _meal(ctx, meal_id)
    before = m.eaten_at
    owned_repo.apply(m, patch)
    ctx.session.add(m)
    ctx.session.flush()
    _dirty_at(ctx, before)
    _dirty_at(ctx, m.eaten_at)
    ctx.commit()
    return m


def _confirm(ctx: Ctx, m: Meal) -> None:
    if m.status == "pending_estimate":
        raise conflict("meal_pending_estimate", "This meal is still being estimated")
    m.status = "confirmed"
    m.follow_up = None
    ctx.session.add(m)
    ctx.session.flush()
    _dirty_at(ctx, m.eaten_at)


def confirm_meal(*, ctx: Ctx, meal_id: uuid.UUID) -> Meal:
    m = _meal(ctx, meal_id)
    _confirm(ctx, m)
    ctx.commit()
    return m


def _draft(it: MealItem) -> F.ItemDraft:
    return F.ItemDraft(
        it.name,
        it.qty,
        it.unit,
        it.kcal,
        it.protein,
        it.carbs,
        it.fat,
        it.assumption,
        fiber=it.fiber,
        sat_fat=it.sat_fat,
        sugar=it.sugar,
        sodium=it.sodium,
    )


def _write_item(ctx: Ctx, it: MealItem, d: F.ItemDraft) -> None:
    owned_repo.apply(it, _item_data(d))
    ctx.session.add(it)
    ctx.session.flush()


def set_item_qty(
    *, ctx: Ctx, meal_id: uuid.UUID, item_id: uuid.UUID, qty: float
) -> MealItem:
    """Change a quantity; the item's macros scale with it."""
    if not qty > 0:
        raise invalid("invalid_qty", "Quantity must be more than zero")
    it = _item(ctx, meal_id, item_id)
    _write_item(ctx, it, F.scale_item(_draft(it), qty))
    _dirty_at(ctx, _meal(ctx, meal_id).eaten_at)
    ctx.commit()
    return it


def set_item_macros(
    *, ctx: Ctx, meal_id: uuid.UUID, item_id: uuid.UUID, patch: dict[str, Any]
) -> MealItem:
    it = _item(ctx, meal_id, item_id)
    owned_repo.apply(it, patch)
    ctx.session.add(it)
    ctx.session.flush()
    _dirty_at(ctx, _meal(ctx, meal_id).eaten_at)
    ctx.commit()
    return it


def add_meal_item(
    *,
    ctx: Ctx,
    meal_id: uuid.UUID,
    food_key: str | None = None,
    item: F.ItemDraft | None = None,
    item_id: uuid.UUID | None = None,
) -> MealItem:
    """Add a food from the built-in table (by key) or a custom item."""
    m = _meal(ctx, meal_id)
    if food_key is not None:
        f = F.food_by_key(food_key)
        if f is None:
            raise not_found("food")
        draft = F.item_from_food(f)
    elif item is not None:
        draft = item
    else:
        raise invalid("item_required", "Give a food or an item")
    (it,) = _append_items(ctx, m, [draft], [item_id])
    _dirty_at(ctx, m.eaten_at)
    ctx.commit()
    return it


def remove_meal_item(*, ctx: Ctx, meal_id: uuid.UUID, item_id: uuid.UUID) -> None:
    it = _item(ctx, meal_id, item_id)
    owned_repo.soft_delete(ctx, it)
    _dirty_at(ctx, _meal(ctx, meal_id).eaten_at)
    ctx.commit()


def answer_follow_up(*, ctx: Ctx, meal_id: uuid.UUID, option: str) -> Meal:
    """Answer the estimate's one question (how much rice): rice items are
    resized and the confidence rises."""
    m = _meal(ctx, meal_id)
    items = repo.meal_items(ctx, m.id)
    ans = F.answer_follow_up([_draft(i) for i in items], m.confidence, option)
    for row, d in zip(items, ans.items, strict=True):
        _write_item(ctx, row, d)
    m.follow_up = None
    m.confidence = ans.confidence
    ctx.session.add(m)
    ctx.session.flush()
    _dirty_at(ctx, m.eaten_at)
    ctx.commit()
    return m


def _delete_meal(ctx: Ctx, meal_id: uuid.UUID) -> None:
    m = _meal(ctx, meal_id)
    owned_repo.soft_delete(ctx, m)
    _dirty_at(ctx, m.eaten_at)


def delete_meal(*, ctx: Ctx, meal_id: uuid.UUID) -> None:
    _delete_meal(ctx, meal_id)
    ctx.commit()


def restore_meal(*, ctx: Ctx, meal_id: uuid.UUID) -> Meal:
    m = owned_repo.require(ctx, Meal, meal_id, what="meal", include_deleted=True)
    owned_repo.restore(ctx, m)
    _dirty_at(ctx, m.eaten_at)
    ctx.commit()
    return m


def duplicate_meal(
    *,
    ctx: Ctx,
    meal_id: uuid.UUID,
    day: date | None = None,
    new_id: uuid.UUID | None = None,
) -> Meal:
    """Copy a meal onto a day (today by default) at the current wall-clock
    time, confirmed."""
    existing = _existing_meal(ctx, new_id)
    if existing is not None:
        return existing
    m = _meal(ctx, meal_id)
    local_now = ctx.now.astimezone(ctx.clock.zone)
    target = day or ctx.today
    at = datetime.combine(
        target, local_now.time().replace(second=0, microsecond=0), tzinfo=ctx.clock.zone
    )
    copy = _new_meal(
        ctx,
        eaten_at=at,
        label=m.label,
        source=m.source,
        raw_input=m.raw_input,
        status="confirmed",
        confidence=m.confidence,
        photo_media_id=m.photo_media_id,
        meal_id=new_id,
    )
    _append_items(ctx, copy, [_draft(i) for i in repo.meal_items(ctx, m.id)])
    ctx.commit()
    return copy


# --------------------------------------------------------------------------
# Targets
# --------------------------------------------------------------------------


def set_macro_target(
    *,
    ctx: Ctx,
    kcal: float,
    protein: float,
    carbs: float,
    fat: float,
    sat_fat_max_g: float | None = None,
    sugar_max_g: float | None = None,
    sodium_max_mg: float | None = None,
    fiber_g: float | None = None,
) -> MacroTarget:
    """A new target version effective from today; past days keep theirs.
    A limit left None reads as the WHO default."""
    today = ctx.today
    t, _ = owned_repo.upsert(
        ctx,
        MacroTarget,
        derived_id("macro-target", ctx.user_id, today.isoformat()),
        {
            "effective_from": today,
            "kcal": kcal,
            "protein": protein,
            "carbs": carbs,
            "fat": fat,
            "sat_fat_max_g": sat_fat_max_g,
            "sugar_max_g": sugar_max_g,
            "sodium_max_mg": sodium_max_mg,
            "fiber_g": fiber_g,
        },
        natural_key=("effective_from",),
    )
    _dirty(ctx, today)
    ctx.commit()
    return t


# --------------------------------------------------------------------------
# Resets
# --------------------------------------------------------------------------

_LOGS: tuple[type[Any], ...] = (
    WorkoutSet,
    WorkoutExercise,
    Workout,
    TemplateItem,
    WorkoutTemplate,
    MealItem,
    Meal,
    WeighIn,
    RestTimer,
)
_ALL: tuple[type[Any], ...] = (*_LOGS, Exercise, MacroTarget, FitnessSettings)


def _tombstone(ctx: Ctx, models: tuple[type[Any], ...]) -> int:
    n = 0
    for model in models:
        for row in owned_repo.list_rows(ctx, model):
            row.deleted_at = ctx.now
            ctx.session.add(row)
            n += 1
    ctx.session.flush()
    active = profile_public.get_live(ctx)
    if active is not None and active.kind == "workout":
        profile_public.end_live(ctx, kind="workout", ref_id=active.ref_id)
    _dirty(ctx, ctx.today)
    return n


def start_fresh(*, ctx: Ctx) -> int:
    """Empty the logs for first-time setup: workouts, templates, meals,
    weigh-ins and the rest timer go; exercises, targets and settings stay."""
    n = _tombstone(ctx, _LOGS)
    ctx.commit()
    return n


def reset_fitness(*, ctx: Ctx) -> int:
    """Back to a new user's fitness: everything removed, then the default
    exercise library, split and settings come back."""
    n = _tombstone(ctx, _ALL)
    settings = repo.get_settings(ctx)
    if settings is not None:
        fresh = FitnessSettings(**ctx.owned())
        owned_repo.apply(
            settings,
            {
                k: getattr(fresh, k)
                for k in FitnessSettings.model_fields
                if k not in owned_repo.PROTECTED
            },
        )
        settings.deleted_at = None
        ctx.session.add(settings)
        ctx.session.flush()
    else:
        owned_repo.insert(ctx, FitnessSettings, {})
    _seed_library(ctx)
    ctx.commit()
    return n
