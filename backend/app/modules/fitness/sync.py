"""Sync registrations for the fitness module (entities + domain actions).

Field writes replay through the generic last-writer-wins path, guarded by the
upserts below wherever a rule applies:

- a child row (template item, workout exercise, set, meal item) must point at
  a parent the caller owns: a foreign key alone would accept another user's
  id;
- a workout is started and finished only by its actions (they claim and
  release the Live bar); an upsert may create a finished backfill or edit
  one, never flip the status;
- a run session cannot end before it starts;
- days a write touches are marked dirty for the stats rollup.
"""

import uuid
from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field

from app.modules.fitness import repo, services
from app.modules.fitness import schema as S
from app.modules.fitness.models import (
    Exercise,
    FitnessSettings,
    MacroTarget,
    Meal,
    MealItem,
    RestTimer,
    RunSession,
    TargetAdjustment,
    TemplateItem,
    WeighIn,
    Workout,
    WorkoutExercise,
    WorkoutSet,
    WorkoutTemplate,
)
from app.modules.sync.registry import Action, Entity, Registry
from app.shared import owned_repo
from app.shared.context import Ctx
from app.shared.domain import invalid, not_found
from app.shared.owned import OwnedRow


def _data(payload: BaseModel) -> dict[str, Any]:
    return payload.model_dump(exclude_unset=True)


def _parent(ctx: Ctx, model: type[OwnedRow], row_id: Any, what: str) -> None:
    if row_id is not None:
        owned_repo.require(ctx, model, row_id, what=what)


def _put(
    ctx: Ctx, model: type[OwnedRow], row_id: uuid.UUID, data: dict[str, Any]
) -> OwnedRow:
    row, _ = owned_repo.upsert(ctx, model, row_id, data)
    return row


def _upsert_exercise(ctx: Ctx, row_id: uuid.UUID, p: BaseModel) -> OwnedRow:
    data = _data(p)
    current = owned_repo.get(ctx, Exercise, row_id)
    gone = owned_repo.get(ctx, Exercise, row_id, include_deleted=True)
    if current is None and gone is not None and gone.merged_into_id is not None:
        # Merged into another exercise: an edit never revives the duplicate.
        raise invalid("exercise_merged", "That exercise was merged into another one")
    rmin = data.get("rep_min", current.rep_min if current else 8)
    rmax = data.get("rep_max", current.rep_max if current else 12)
    if rmax < rmin:
        raise invalid("invalid_rep_range", "The rep range ends before it starts")
    if "name" in data:
        data["name"] = data["name"].strip()
    services._guard_merged(current, data.get("archived"))
    return _put(ctx, Exercise, row_id, data)


def _exercise_ref(ctx: Ctx, data: dict[str, Any]) -> None:
    """Point a reference at the exercise's survivor: a device that was
    offline through a merge still sends the old id."""
    if data.get("exercise_id") is None:
        return
    ex = owned_repo.require(
        ctx, Exercise, data["exercise_id"], what="exercise", include_deleted=True
    )
    if ex.merged_into_id is not None:
        ex = services.survivor_of(ctx, ex)
    elif ex.deleted_at is not None:
        raise not_found("exercise")
    data["exercise_id"] = ex.id


def _upsert_template_item(ctx: Ctx, row_id: uuid.UUID, p: BaseModel) -> OwnedRow:
    data = _data(p)
    if data.get("template_id") is not None:
        # Routines are shared: only their author (or an admin) adds slots.
        owned_repo.require_writable(
            ctx, WorkoutTemplate, data["template_id"], what="template"
        )
    _exercise_ref(ctx, data)
    return _put(ctx, TemplateItem, row_id, data)


def _upsert_workout(ctx: Ctx, row_id: uuid.UUID, p: BaseModel) -> OwnedRow:
    data = _data(p)
    current = owned_repo.get(ctx, Workout, row_id)
    if current is None:
        if data.get("status", "finished") != "finished":
            raise invalid(
                "use_start_action", "Start a workout with fitness.start_workout"
            )
        data["status"] = "finished"
        if data.get("ended_at") is None:
            raise invalid("ended_at_required", "A logged workout needs an end time")
    elif "status" in data and data["status"] != current.status:
        raise invalid(
            "use_finish_action", "Finish a workout with fitness.finish_workout"
        )
    _parent(ctx, WorkoutTemplate, data.get("template_id"), "template")
    row = owned_repo.upsert(ctx, Workout, row_id, data)[0]
    if row.ended_at is not None and row.ended_at < row.started_at:
        raise invalid("end_before_start", "A workout cannot end before it started")
    services._dirty_at(ctx, row.started_at)
    return row


def _delete_workout(ctx: Ctx, row_id: uuid.UUID) -> None:
    from app.modules.fitness import public

    public.delete_workout(ctx, workout_id=row_id)


def _upsert_workout_exercise(ctx: Ctx, row_id: uuid.UUID, p: BaseModel) -> OwnedRow:
    data = _data(p)
    _parent(ctx, Workout, data.get("workout_id"), "workout")
    _exercise_ref(ctx, data)
    return _put(ctx, WorkoutExercise, row_id, data)


def _upsert_workout_set(ctx: Ctx, row_id: uuid.UUID, p: BaseModel) -> OwnedRow:
    data = _data(p)
    _parent(ctx, WorkoutExercise, data.get("workout_exercise_id"), "workout_exercise")
    row = _put(ctx, WorkoutSet, row_id, data)
    assert isinstance(row, WorkoutSet)
    we = owned_repo.get(ctx, WorkoutExercise, row.workout_exercise_id)
    w = owned_repo.get(ctx, Workout, we.workout_id) if we else None
    if w is not None:
        services._dirty_at(ctx, w.started_at)
    return row


def _upsert_weigh_in(ctx: Ctx, row_id: uuid.UUID, p: BaseModel) -> OwnedRow:
    before = owned_repo.get(ctx, WeighIn, row_id)
    row = owned_repo.upsert(ctx, WeighIn, row_id, _data(p))[0]
    if before is not None:
        services._dirty_at(ctx, before.measured_at)
    services._dirty_at(ctx, row.measured_at)
    return row


def _upsert_run_session(ctx: Ctx, row_id: uuid.UUID, p: BaseModel) -> OwnedRow:
    assert isinstance(p, S.RunSessionIn)
    data = _data(p)
    for key in ("route", "splits"):
        if key in data and data[key] is None:
            data[key] = []
    if p.splits is not None:
        # Every split carries all three keys (elev_m null when unknown).
        data["splits"] = [s.model_dump() for s in p.splits]
    current = owned_repo.get(ctx, RunSession, row_id, include_deleted=True)
    # Checked on the merged row before writing: the table's CHECK would
    # otherwise turn it into an anonymous integrity conflict.
    start = data.get("started_at", current.started_at if current else None)
    end = data.get("ended_at", current.ended_at if current else None)
    if start is not None and end is not None and end < start:
        raise invalid("end_before_start", "A session cannot end before it started")
    # The row object is updated in place, so keep the day it leaves now.
    was = current.started_at if current is not None else None
    row = owned_repo.upsert(ctx, RunSession, row_id, data)[0]
    if was is not None:
        services._dirty_at(ctx, was)
    services._dirty_at(ctx, row.started_at)
    return row


def _upsert_target(ctx: Ctx, row_id: uuid.UUID, p: BaseModel) -> OwnedRow:
    data = _data(p)
    natural = ("effective_from",) if "effective_from" in data else ()
    row = owned_repo.upsert(ctx, MacroTarget, row_id, data, natural_key=natural)[0]
    services._dirty(ctx, row.effective_from)
    return row


def _upsert_adjustment(ctx: Ctx, row_id: uuid.UUID, p: BaseModel) -> OwnedRow:
    # The device's local day can be a day off the server's (travel, or
    # adding yesterday's burn after midnight); anything further is a bug.
    data = _data(p)
    before = owned_repo.get(ctx, TargetAdjustment, row_id, include_deleted=True)
    day = data.get("day") or (before.day if before else None)
    if day is not None and abs((day - ctx.today).days) > 1:
        raise invalid(
            "adjustment_day_out_of_range",
            "An eat-back can only be added to today or yesterday.",
        )
    natural = ("day",) if "day" in data else ()
    row = owned_repo.upsert(ctx, TargetAdjustment, row_id, data, natural_key=natural)[0]
    services._dirty(ctx, row.day)
    return row


def _upsert_meal(ctx: Ctx, row_id: uuid.UUID, p: BaseModel) -> OwnedRow:
    before = owned_repo.get(ctx, Meal, row_id)
    row = owned_repo.upsert(ctx, Meal, row_id, _data(p))[0]
    if before is not None:
        services._dirty_at(ctx, before.eaten_at)
    services._dirty_at(ctx, row.eaten_at)
    return row


def _upsert_meal_item(ctx: Ctx, row_id: uuid.UUID, p: BaseModel) -> OwnedRow:
    data = _data(p)
    _parent(ctx, Meal, data.get("meal_id"), "meal")
    row = _put(ctx, MealItem, row_id, data)
    assert isinstance(row, MealItem)
    meal = owned_repo.get(ctx, Meal, row.meal_id)
    if meal is not None:
        services._dirty_at(ctx, meal.eaten_at)
    return row


def _upsert_settings(ctx: Ctx, row_id: uuid.UUID, p: BaseModel) -> OwnedRow:
    """One settings row per user: an op for any id writes the user's row."""
    del row_id
    row = services.ensure_settings(ctx)
    owned_repo.apply(row, _data(p))
    ctx.session.add(row)
    ctx.session.flush()
    services._dirty(ctx, ctx.today)
    return row


# --------------------------------------------------------------------------
# Actions
# --------------------------------------------------------------------------


def _dump(model: type[BaseModel], row: Any) -> dict[str, Any]:
    return model.model_validate(row).model_dump(mode="json")


class StartArgs(BaseModel):
    source: Literal["empty", "template", "repeat"] = "empty"
    template_id: uuid.UUID | None = None
    from_workout_id: uuid.UUID | None = None
    workout_id: uuid.UUID | None = None


def _start(ctx: Ctx, a: dict[str, Any]) -> dict[str, Any]:
    w, resumed = services.start_workout(ctx=ctx, **a)
    return {"workout": _dump(S.WorkoutPublic, w), "resumed": resumed}


class FinishArgs(BaseModel):
    workout_id: uuid.UUID
    unfinished: Literal["remove", "done"] = "remove"
    end_at: datetime | None = None


def _finish(ctx: Ctx, a: dict[str, Any]) -> dict[str, Any]:
    w = services.finish_workout(ctx=ctx, **a)
    return {"workout": _dump(S.WorkoutPublic, w)}


class WorkoutArgs(BaseModel):
    workout_id: uuid.UUID


def _discard(ctx: Ctx, a: dict[str, Any]) -> dict[str, Any]:
    services.discard_workout(ctx=ctx, workout_id=a["workout_id"])
    return {}


class ToggleArgs(BaseModel):
    workout_id: uuid.UUID
    workout_exercise_id: uuid.UUID
    set_id: uuid.UUID


def _toggle(ctx: Ctx, a: dict[str, Any]) -> dict[str, Any]:
    st, completed, rest = services.toggle_set(
        ctx=ctx,
        workout_id=a["workout_id"],
        we_id=a["workout_exercise_id"],
        set_id=a["set_id"],
    )
    return {
        "completed": completed,
        "set": _dump(S.WorkoutSetPublic, st),
        "rest": _dump(S.RestTimerPublic, rest) if rest else None,
    }


class RestStartArgs(BaseModel):
    sec: int | None = Field(default=None, ge=0, le=900)


class RestAdjustArgs(BaseModel):
    delta: int = Field(ge=-900, le=900)


class NoArgs(BaseModel):
    pass


def _rest_start(ctx: Ctx, a: dict[str, Any]) -> dict[str, Any]:
    return {
        "rest": _dump(S.RestTimerPublic, services.start_rest(ctx=ctx, sec=a["sec"]))
    }


def _rest_adjust(ctx: Ctx, a: dict[str, Any]) -> dict[str, Any]:
    row = services.adjust_rest(ctx=ctx, delta=a["delta"])
    return {"rest": _dump(S.RestTimerPublic, row) if row else None}


def _rest_skip(ctx: Ctx, a: dict[str, Any]) -> dict[str, Any]:
    del a
    services.skip_rest(ctx=ctx)
    return {}


class MealArgs(BaseModel):
    meal_id: uuid.UUID


class FollowUpArgs(BaseModel):
    meal_id: uuid.UUID
    option: str = Field(min_length=1, max_length=40)


def _confirm(ctx: Ctx, a: dict[str, Any]) -> dict[str, Any]:
    m = services.confirm_meal(ctx=ctx, meal_id=a["meal_id"])
    return {"meal": _dump(S.MealPublic, m)}


def _follow_up(ctx: Ctx, a: dict[str, Any]) -> dict[str, Any]:
    m = services.answer_follow_up(ctx=ctx, meal_id=a["meal_id"], option=a["option"])
    items = repo.meal_items(ctx, m.id)
    return {
        "meal": _dump(S.MealPublic, m),
        "items": [_dump(S.MealItemPublic, i) for i in items],
    }


class MergeArgs(BaseModel):
    source_id: uuid.UUID
    target_id: uuid.UUID


def _merge(ctx: Ctx, a: dict[str, Any]) -> dict[str, Any]:
    target = services.merge_exercises(ctx=ctx, **a)
    return {"exercise": _dump(S.ExercisePublic, target)}


def register(r: Registry) -> None:
    entities: list[Entity] = [
        Entity(
            "exercise",
            Exercise,
            S.ExerciseIn,
            S.ExercisePublic,
            upsert=_upsert_exercise,
            create_required=("name", "equipment", "muscle"),
        ),
        Entity(
            "workout_template",
            WorkoutTemplate,
            S.WorkoutTemplateIn,
            S.WorkoutTemplatePublic,
            create_required=("name",),
        ),
        Entity(
            "template_item",
            TemplateItem,
            S.TemplateItemIn,
            S.TemplateItemPublic,
            upsert=_upsert_template_item,
            create_required=("template_id", "exercise_id", "position"),
        ),
        Entity(
            "workout",
            Workout,
            S.WorkoutIn,
            S.WorkoutPublic,
            upsert=_upsert_workout,
            delete=_delete_workout,
            create_required=("name", "started_at", "ended_at"),
        ),
        Entity(
            "workout_exercise",
            WorkoutExercise,
            S.WorkoutExerciseIn,
            S.WorkoutExercisePublic,
            upsert=_upsert_workout_exercise,
            create_required=("workout_id", "exercise_id", "position"),
        ),
        Entity(
            "workout_set",
            WorkoutSet,
            S.WorkoutSetIn,
            S.WorkoutSetPublic,
            upsert=_upsert_workout_set,
            create_required=("workout_exercise_id", "position"),
        ),
        Entity(
            "weigh_in",
            WeighIn,
            S.WeighInIn,
            S.WeighInPublic,
            upsert=_upsert_weigh_in,
            create_required=("measured_at", "weight_kg"),
        ),
        Entity(
            "run_session",
            RunSession,
            S.RunSessionIn,
            S.RunSessionPublic,
            upsert=_upsert_run_session,
            create_required=("kind", "started_at", "ended_at"),
        ),
        Entity(
            "macro_target",
            MacroTarget,
            S.MacroTargetIn,
            S.MacroTargetPublic,
            upsert=_upsert_target,
            create_required=("effective_from", "kcal", "protein", "carbs", "fat"),
        ),
        Entity(
            "target_adjustment",
            TargetAdjustment,
            S.TargetAdjustmentIn,
            S.TargetAdjustmentPublic,
            upsert=_upsert_adjustment,
            create_required=("day", "kcal"),
        ),
        Entity(
            "meal",
            Meal,
            S.MealIn,
            S.MealPublic,
            upsert=_upsert_meal,
            create_required=("eaten_at", "label"),
        ),
        Entity(
            "meal_item",
            MealItem,
            S.MealItemIn,
            S.MealItemPublic,
            upsert=_upsert_meal_item,
            create_required=(
                "meal_id",
                "name",
                "qty",
                "unit",
                "kcal",
                "protein",
                "carbs",
                "fat",
            ),
        ),
        Entity(
            "fitness_settings",
            FitnessSettings,
            S.FitnessSettingsIn,
            S.FitnessSettingsPublic,
            upsert=_upsert_settings,
        ),
        # Written by the fitness.rest.* actions only.
        Entity(
            "rest_timer",
            RestTimer,
            NoArgs,
            S.RestTimerPublic,
            read_only=True,
        ),
    ]
    for e in entities:
        r.entity(e)
    actions = [
        Action("fitness.start_workout", _start, StartArgs),
        Action("fitness.finish_workout", _finish, FinishArgs),
        Action("fitness.discard_workout", _discard, WorkoutArgs),
        Action("fitness.toggle_set", _toggle, ToggleArgs),
        Action("fitness.rest.start", _rest_start, RestStartArgs),
        Action("fitness.rest.adjust", _rest_adjust, RestAdjustArgs),
        Action("fitness.rest.skip", _rest_skip, NoArgs),
        Action("fitness.confirm_meal", _confirm, MealArgs),
        Action("fitness.answer_follow_up", _follow_up, FollowUpArgs),
        Action("fitness.merge_exercises", _merge, MergeArgs),
    ]
    for a in actions:
        r.action(a)
