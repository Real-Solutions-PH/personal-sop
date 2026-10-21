"""Fitness REST routes: one endpoint per action on the fitness screens
(hub, logger, history, exercises, templates, body, nutrition, meals,
targets, settings, stats, share card). Weights are kilograms throughout."""

import uuid
from datetime import date
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Query
from sqlmodel import col

from app.modules.fitness import foods as F
from app.modules.fitness import repo, services, views
from app.modules.fitness import schema as S
from app.modules.fitness.models import Exercise, Meal, WeighIn, Workout, WorkoutTemplate
from app.modules.iam.deps import require_permission
from app.shared import owned_repo
from app.shared.context import Ctx, CtxDep
from app.shared.pagination import PaginationDep
from app.shared.rate_limit import rate_limited
from app.shared.schema import Message

router = APIRouter(prefix="/fitness", tags=["fitness"])

READ = [Depends(require_permission("fitness:read"))]
WRITE = [rate_limited("fitness"), Depends(require_permission("fitness:write"))]
Days = Annotated[int, Query(ge=1, le=366)]


def _workout_out(ctx: Ctx, w: Workout) -> S.WorkoutOut:
    return views.workout_out(ctx, w)


def _meal(ctx: Ctx, meal_id: uuid.UUID) -> S.MealOut:
    return views.meal_out(ctx, owned_repo.require(ctx, Meal, meal_id, what="meal"))


def _patch(model: Any) -> dict[str, Any]:
    data: dict[str, Any] = model.model_dump(exclude_unset=True)
    return data


# --------------------------------------------------------------------------
# Hub, stats
# --------------------------------------------------------------------------


@router.get("/overview", response_model=S.OverviewOut, dependencies=READ)
def overview(ctx: CtxDep) -> Any:
    """Fitness hub (FIT-01) and the Today cards."""
    services.get_settings(ctx=ctx)
    return views.overview(ctx)


@router.get("/stats", response_model=S.StatsOut, dependencies=READ)
def stats(ctx: CtxDep, days: Days = 30) -> Any:
    """Fitness stats (FIT-26)."""
    return views.stats(ctx, days)


# --------------------------------------------------------------------------
# Workouts
# --------------------------------------------------------------------------


@router.get("/workouts", response_model=S.WorkoutsOut, dependencies=READ)
def list_workouts(
    ctx: CtxDep,
    pagination: PaginationDep,
    template_id: uuid.UUID | None = None,
    exercise_id: uuid.UUID | None = None,
    q: Annotated[str | None, Query(max_length=80)] = None,
) -> Any:
    """Workout history (FIT-02): finished workouts, newest first."""
    return views.workout_summaries(
        ctx,
        skip=pagination.skip,
        limit=pagination.limit,
        template_id=template_id,
        exercise_id=exercise_id,
        q=q,
    )


@router.get("/workouts/active", response_model=S.WorkoutOut | None, dependencies=READ)
def active_workout(ctx: CtxDep) -> Any:
    """The workout in progress, if any (resume sheet FIT-24)."""
    w = repo.active_workout(ctx)
    return _workout_out(ctx, w) if w else None


@router.post("/workouts/start", response_model=S.StartWorkoutOut, dependencies=WRITE)
def start_workout(ctx: CtxDep, body: S.StartWorkout) -> Any:
    """Start sheet (FIT-04): empty, from a template, or repeat a workout.
    409 ``live_session_busy`` when a timer or routine holds the Live bar."""
    w, resumed = services.start_workout(
        ctx=ctx,
        source=body.source,
        template_id=body.template_id,
        from_workout_id=body.workout_id,
        workout_id=body.id,
    )
    return S.StartWorkoutOut(workout=_workout_out(ctx, w), resumed=resumed)


@router.get("/workouts/{workout_id}", response_model=S.WorkoutOut, dependencies=READ)
def read_workout(ctx: CtxDep, workout_id: uuid.UUID) -> Any:
    """Workout detail (FIT-03) or the live logger (FIT-05)."""
    return _workout_out(
        ctx, owned_repo.require(ctx, Workout, workout_id, what="workout")
    )


@router.patch("/workouts/{workout_id}", response_model=S.WorkoutOut, dependencies=WRITE)
def update_workout(ctx: CtxDep, workout_id: uuid.UUID, body: S.WorkoutMeta) -> Any:
    w = services.update_workout_meta(ctx=ctx, workout_id=workout_id, patch=_patch(body))
    return _workout_out(ctx, w)


@router.post(
    "/workouts/{workout_id}/finish", response_model=S.WorkoutOut, dependencies=WRITE
)
def finish_workout(ctx: CtxDep, workout_id: uuid.UUID, body: S.FinishWorkout) -> Any:
    """Finish (FIT-09): unchecked sets removed or marked done."""
    w = services.finish_workout(
        ctx=ctx, workout_id=workout_id, unfinished=body.unfinished, end_at=body.end_at
    )
    return _workout_out(ctx, w)


@router.post("/workouts/{workout_id}/discard", dependencies=WRITE)
def discard_workout(ctx: CtxDep, workout_id: uuid.UUID) -> Message:
    services.discard_workout(ctx=ctx, workout_id=workout_id)
    return Message(message="Workout discarded")


@router.delete("/workouts/{workout_id}", dependencies=WRITE)
def delete_workout(ctx: CtxDep, workout_id: uuid.UUID) -> Message:
    services.delete_workout(ctx=ctx, workout_id=workout_id)
    return Message(message="Workout deleted")


@router.post(
    "/workouts/{workout_id}/restore", response_model=S.WorkoutOut, dependencies=WRITE
)
def restore_workout(ctx: CtxDep, workout_id: uuid.UUID) -> Any:
    """Undo a delete."""
    return _workout_out(ctx, services.restore_workout(ctx=ctx, workout_id=workout_id))


@router.post(
    "/workouts/{workout_id}/save-as-template",
    response_model=S.TemplateOut,
    dependencies=WRITE,
)
def save_as_template(ctx: CtxDep, workout_id: uuid.UUID, body: S.SaveAsTemplate) -> Any:
    t = services.save_as_template(
        ctx=ctx, workout_id=workout_id, name=body.name, template_id=body.id
    )
    return views.template_out(ctx, t)


@router.get(
    "/workouts/{workout_id}/share-card",
    response_model=S.ShareCardOut,
    dependencies=READ,
)
def share_card(
    ctx: CtxDep, workout_id: uuid.UUID, exercise_id: uuid.UUID | None = None
) -> Any:
    """Numbers for the share card composer (FIT-23)."""
    w = owned_repo.require(ctx, Workout, workout_id, what="workout")
    return views.share_card(ctx, w, exercise_id)


@router.post(
    "/workouts/{workout_id}/exercises", response_model=S.WorkoutOut, dependencies=WRITE
)
def add_exercises(ctx: CtxDep, workout_id: uuid.UUID, body: S.AddExercises) -> Any:
    """Exercise picker (FIT-07): append lifts with planned sets."""
    services.add_exercises(
        ctx=ctx, workout_id=workout_id, exercise_ids=body.exercise_ids, ids=body.ids
    )
    return _workout_out(
        ctx, owned_repo.require(ctx, Workout, workout_id, what="workout")
    )


@router.patch(
    "/workouts/{workout_id}/exercises/{we_id}",
    response_model=S.WorkoutExercisePublic,
    dependencies=WRITE,
)
def set_exercise_note(
    ctx: CtxDep, workout_id: uuid.UUID, we_id: uuid.UUID, body: S.ExerciseNote
) -> Any:
    return services.set_exercise_note(
        ctx=ctx, workout_id=workout_id, we_id=we_id, note=body.note
    )


@router.delete("/workouts/{workout_id}/exercises/{we_id}", dependencies=WRITE)
def remove_exercise(ctx: CtxDep, workout_id: uuid.UUID, we_id: uuid.UUID) -> Message:
    services.remove_exercise(ctx=ctx, workout_id=workout_id, we_id=we_id)
    return Message(message="Exercise removed")


@router.post(
    "/workouts/{workout_id}/exercises/{we_id}/move",
    response_model=list[S.WorkoutExercisePublic],
    dependencies=WRITE,
)
def move_exercise(
    ctx: CtxDep, workout_id: uuid.UUID, we_id: uuid.UUID, body: S.MoveExercise
) -> Any:
    return services.move_exercise(
        ctx=ctx, workout_id=workout_id, we_id=we_id, dir=body.dir
    )


@router.post(
    "/workouts/{workout_id}/exercises/{we_id}/replace",
    response_model=S.WorkoutOut,
    dependencies=WRITE,
)
def replace_exercise(
    ctx: CtxDep, workout_id: uuid.UUID, we_id: uuid.UUID, body: S.ReplaceExercise
) -> Any:
    services.replace_exercise(
        ctx=ctx, workout_id=workout_id, we_id=we_id, exercise_id=body.exercise_id
    )
    return _workout_out(
        ctx, owned_repo.require(ctx, Workout, workout_id, what="workout")
    )


@router.post(
    "/workouts/{workout_id}/exercises/{we_id}/sets",
    response_model=S.SetOut,
    dependencies=WRITE,
)
def add_set(
    ctx: CtxDep, workout_id: uuid.UUID, we_id: uuid.UUID, body: S.AddSet
) -> Any:
    return services.add_set(ctx=ctx, workout_id=workout_id, we_id=we_id, set_id=body.id)


@router.patch(
    "/workouts/{workout_id}/exercises/{we_id}/sets/{set_id}",
    response_model=S.SetOut,
    dependencies=WRITE,
)
def update_set(
    ctx: CtxDep,
    workout_id: uuid.UUID,
    we_id: uuid.UUID,
    set_id: uuid.UUID,
    body: S.SetPatch,
) -> Any:
    """Set edit sheet (FIT-06)."""
    return services.update_set(
        ctx=ctx, workout_id=workout_id, we_id=we_id, set_id=set_id, patch=_patch(body)
    )


@router.post(
    "/workouts/{workout_id}/exercises/{we_id}/sets/{set_id}/toggle",
    response_model=S.ToggleSetOut,
    dependencies=WRITE,
)
def toggle_set(
    ctx: CtxDep, workout_id: uuid.UUID, we_id: uuid.UUID, set_id: uuid.UUID
) -> Any:
    """The one-tap tick; starts the rest timer on a live workout."""
    st, completed, rest = services.toggle_set(
        ctx=ctx, workout_id=workout_id, we_id=we_id, set_id=set_id
    )
    return S.ToggleSetOut(
        completed=completed,
        set=S.SetOut.model_validate(st),
        rest=S.RestTimerPublic.model_validate(rest) if rest else None,
    )


@router.delete(
    "/workouts/{workout_id}/exercises/{we_id}/sets/{set_id}", dependencies=WRITE
)
def remove_set(
    ctx: CtxDep, workout_id: uuid.UUID, we_id: uuid.UUID, set_id: uuid.UUID
) -> Message:
    services.remove_set(ctx=ctx, workout_id=workout_id, we_id=we_id, set_id=set_id)
    return Message(message="Set removed")


# --------------------------------------------------------------------------
# Rest timer
# --------------------------------------------------------------------------


@router.get("/rest", response_model=S.RestTimerPublic | None, dependencies=READ)
def read_rest(ctx: CtxDep) -> Any:
    return services.get_rest(ctx)


@router.post("/rest/start", response_model=S.RestTimerPublic, dependencies=WRITE)
def start_rest(ctx: CtxDep, body: S.RestStart) -> Any:
    return services.start_rest(ctx=ctx, sec=body.sec)


@router.post(
    "/rest/adjust", response_model=S.RestTimerPublic | None, dependencies=WRITE
)
def adjust_rest(ctx: CtxDep, body: S.RestAdjust) -> Any:
    """±15 s on the rest banner (FIT-08)."""
    return services.adjust_rest(ctx=ctx, delta=body.delta)


@router.post("/rest/skip", dependencies=WRITE)
def skip_rest(ctx: CtxDep) -> Message:
    services.skip_rest(ctx=ctx)
    return Message(message="Rest skipped")


# --------------------------------------------------------------------------
# Templates
# --------------------------------------------------------------------------


@router.get("/templates", response_model=S.TemplatesOut, dependencies=READ)
def list_templates(ctx: CtxDep, pagination: PaginationDep) -> Any:
    """Templates list (FIT-13)."""
    services.get_settings(ctx=ctx)
    return views.templates(ctx, skip=pagination.skip, limit=pagination.limit)


@router.post("/templates", response_model=S.TemplateOut, dependencies=WRITE)
def create_template(ctx: CtxDep, body: S.TemplateUpsert) -> Any:
    t = services.upsert_template(
        ctx=ctx,
        name=body.name,
        items=[(i.exercise_id, i.sets) for i in body.items],
        template_id=body.id,
    )
    return views.template_out(ctx, t)


@router.get("/templates/{template_id}", response_model=S.TemplateOut, dependencies=READ)
def read_template(ctx: CtxDep, template_id: uuid.UUID) -> Any:
    t = owned_repo.require(ctx, WorkoutTemplate, template_id, what="template")
    return views.template_out(ctx, t)


@router.put(
    "/templates/{template_id}", response_model=S.TemplateOut, dependencies=WRITE
)
def put_template(ctx: CtxDep, template_id: uuid.UUID, body: S.TemplateUpsert) -> Any:
    """Template editor (FIT-14): name and the ordered exercises, whole."""
    t = services.upsert_template(
        ctx=ctx,
        name=body.name,
        items=[(i.exercise_id, i.sets) for i in body.items],
        template_id=template_id,
    )
    return views.template_out(ctx, t)


@router.delete("/templates/{template_id}", dependencies=WRITE)
def delete_template(ctx: CtxDep, template_id: uuid.UUID) -> Message:
    services.delete_template(ctx=ctx, template_id=template_id)
    return Message(message="Template deleted")


@router.post(
    "/templates/{template_id}/restore", response_model=S.TemplateOut, dependencies=WRITE
)
def restore_template(ctx: CtxDep, template_id: uuid.UUID) -> Any:
    return views.template_out(
        ctx, services.restore_template(ctx=ctx, template_id=template_id)
    )


# --------------------------------------------------------------------------
# Exercises
# --------------------------------------------------------------------------


@router.get("/exercises", response_model=S.ExercisesOut, dependencies=READ)
def list_exercises(
    ctx: CtxDep,
    pagination: PaginationDep,
    q: Annotated[str | None, Query(max_length=80)] = None,
    muscle: S.Muscle | None = None,
    include_archived: bool = False,
) -> Any:
    """Exercise library (FIT-10) and picker (FIT-07)."""
    services.get_settings(ctx=ctx)
    return views.exercises(
        ctx,
        skip=pagination.skip,
        limit=pagination.limit,
        q=q,
        muscle=muscle,
        include_archived=include_archived,
    )


@router.post("/exercises", response_model=S.ExercisePublic, dependencies=WRITE)
def create_exercise(ctx: CtxDep, body: S.ExerciseUpsert) -> Any:
    """Exercise edit sheet (FIT-12), create."""
    return services.upsert_exercise(
        ctx=ctx, data=body.model_dump(exclude={"id"}), exercise_id=body.id
    )


@router.get(
    "/exercises/{exercise_id}", response_model=S.ExerciseDetail, dependencies=READ
)
def read_exercise(ctx: CtxDep, exercise_id: uuid.UUID) -> Any:
    """Exercise progress (FIT-11): history, PRs, suggestion, stall flag."""
    ex = owned_repo.require(ctx, Exercise, exercise_id, what="exercise")
    return views.exercise_detail(ctx, ex)


@router.put(
    "/exercises/{exercise_id}", response_model=S.ExercisePublic, dependencies=WRITE
)
def put_exercise(ctx: CtxDep, exercise_id: uuid.UUID, body: S.ExerciseUpsert) -> Any:
    return services.upsert_exercise(
        ctx=ctx, data=body.model_dump(exclude={"id"}), exercise_id=exercise_id
    )


@router.post(
    "/exercises/{exercise_id}/archive",
    response_model=S.ExercisePublic,
    dependencies=WRITE,
)
def archive_exercise(
    ctx: CtxDep, exercise_id: uuid.UUID, body: S.ArchiveExercise
) -> Any:
    return services.set_exercise_archived(
        ctx=ctx, exercise_id=exercise_id, archived=body.archived
    )


# --------------------------------------------------------------------------
# Body
# --------------------------------------------------------------------------


@router.get("/body", response_model=S.BodyOut, dependencies=READ)
def body_weight(ctx: CtxDep, days: Days = 30) -> Any:
    """Body weight (FIT-20): trend and weekly rate."""
    services.get_settings(ctx=ctx)
    return views.body(ctx, days)


@router.get("/weigh-ins", response_model=S.WeighInsOut, dependencies=READ)
def list_weigh_ins(ctx: CtxDep, pagination: PaginationDep) -> Any:
    rows = owned_repo.list_rows(
        ctx,
        WeighIn,
        order_by=[col(WeighIn.measured_at).desc()],
        skip=pagination.skip,
        limit=pagination.limit,
    )
    return S.WeighInsOut(
        data=[S.WeighInPublic.model_validate(r) for r in rows],
        count=owned_repo.count_rows(ctx, WeighIn),
    )


@router.post("/weigh-ins", response_model=S.WeighInPublic, dependencies=WRITE)
def log_weigh_in(ctx: CtxDep, body: S.WeighInCreate) -> Any:
    """Weigh-in sheet (FIT-19)."""
    return services.log_weigh_in(
        ctx=ctx,
        kg=body.weight_kg,
        at=body.measured_at,
        body_fat_pct=body.body_fat_pct,
        note=body.note,
        weigh_in_id=body.id,
    )


@router.patch(
    "/weigh-ins/{weigh_in_id}", response_model=S.WeighInPublic, dependencies=WRITE
)
def update_weigh_in(ctx: CtxDep, weigh_in_id: uuid.UUID, body: S.WeighInUpdate) -> Any:
    """Weigh-in edit sheet (FIT-21)."""
    return services.update_weigh_in(
        ctx=ctx, weigh_in_id=weigh_in_id, patch=_patch(body)
    )


@router.delete("/weigh-ins/{weigh_in_id}", dependencies=WRITE)
def delete_weigh_in(ctx: CtxDep, weigh_in_id: uuid.UUID) -> Message:
    services.delete_weigh_in(ctx=ctx, weigh_in_id=weigh_in_id)
    return Message(message="Weigh-in deleted")


@router.post(
    "/weigh-ins/{weigh_in_id}/restore",
    response_model=S.WeighInPublic,
    dependencies=WRITE,
)
def restore_weigh_in(ctx: CtxDep, weigh_in_id: uuid.UUID) -> Any:
    return services.restore_weigh_in(ctx=ctx, weigh_in_id=weigh_in_id)


# --------------------------------------------------------------------------
# Nutrition and targets
# --------------------------------------------------------------------------


@router.get("/nutrition/day", response_model=S.NutritionDayOut, dependencies=READ)
def nutrition_day(ctx: CtxDep, day: date | None = None) -> Any:
    """Nutrition day (FIT-15): totals, macros left, meals."""
    return views.nutrition_day(ctx, day or ctx.today)


@router.get(
    "/nutrition/history", response_model=S.NutritionHistoryOut, dependencies=READ
)
def nutrition_history(
    ctx: CtxDep,
    days: Days = 30,
    offset: Annotated[int, Query(ge=0, le=366)] = 0,
) -> Any:
    """Nutrition history (FIT-25): verdict per day and adherence."""
    return views.nutrition_history(ctx, days, offset)


@router.get("/targets", response_model=S.TargetsOut, dependencies=READ)
def read_targets(ctx: CtxDep) -> Any:
    """Macro targets (FIT-18): the one in force and every version."""
    return views.targets(ctx)


@router.put("/targets", response_model=S.MacroTargetPublic, dependencies=WRITE)
def set_targets(ctx: CtxDep, body: S.TargetSet) -> Any:
    return services.set_macro_target(
        ctx=ctx, kcal=body.kcal, protein=body.protein, carbs=body.carbs, fat=body.fat
    )


# --------------------------------------------------------------------------
# Meals
# --------------------------------------------------------------------------


@router.get("/meals", response_model=S.MealsOut, dependencies=READ)
def list_meals(ctx: CtxDep, pagination: PaginationDep, day: date | None = None) -> Any:
    """Meals of one day, or every meal newest first."""
    if day is not None:
        meals = views.meals_on(ctx, day)
        return S.MealsOut(
            data=meals[pagination.skip : pagination.skip + pagination.limit],
            count=len(meals),
        )
    rows = owned_repo.list_rows(
        ctx,
        Meal,
        order_by=[col(Meal.eaten_at).desc()],
        skip=pagination.skip,
        limit=pagination.limit,
    )
    items = repo.items_by_meal(ctx, [m.id for m in rows])
    return S.MealsOut(
        data=[views.meal_out_from(m, items[m.id]) for m in rows],
        count=owned_repo.count_rows(ctx, Meal),
    )


@router.post("/meals", response_model=S.MealOut, dependencies=WRITE)
def log_meal(ctx: CtxDep, body: S.MealCreate) -> Any:
    """A meal entered by hand (manual macros)."""
    m = services.log_meal(
        ctx=ctx,
        items=[_draft(i) for i in body.items],
        eaten_at=body.eaten_at,
        label=body.label,
        source=body.source,
        raw_input=body.raw_input,
        meal_id=body.id,
        item_ids=[i.id for i in body.items],
    )
    return views.meal_out(ctx, m)


def _draft(i: S.ItemSpec) -> F.ItemDraft:
    return F.ItemDraft(
        i.name, i.qty, i.unit, i.kcal, i.protein, i.carbs, i.fat, i.assumption
    )


@router.post("/meals/estimate", response_model=S.MealOut, dependencies=WRITE)
def estimate_meal(ctx: CtxDep, body: S.MealEstimate) -> Any:
    """Describe a meal (text or voice transcript): the built-in estimator
    itemises it for review (FIT-16). 422 ``meal_not_recognised``."""
    m = services.estimate_meal(
        ctx=ctx,
        text=body.text,
        eaten_at=body.eaten_at,
        label=body.label,
        source=body.source,
        meal_id=body.id,
    )
    return views.meal_out(ctx, m)


@router.post("/meals/photo", response_model=S.MealOut, dependencies=WRITE)
def queue_meal_photo(ctx: CtxDep, body: S.MealPhoto) -> Any:
    """A meal photo waiting for its estimate (``pending_estimate``)."""
    m = services.queue_meal_photo(
        ctx=ctx,
        hint=body.hint,
        eaten_at=body.eaten_at,
        photo_media_id=body.photo_media_id,
        meal_id=body.id,
    )
    return views.meal_out(ctx, m)


@router.get("/meals/{meal_id}", response_model=S.MealOut, dependencies=READ)
def read_meal(ctx: CtxDep, meal_id: uuid.UUID) -> Any:
    """Meal detail (FIT-17) and estimate review (FIT-16)."""
    return _meal(ctx, meal_id)


@router.patch("/meals/{meal_id}", response_model=S.MealOut, dependencies=WRITE)
def update_meal(ctx: CtxDep, meal_id: uuid.UUID, body: S.MealUpdate) -> Any:
    """Change the time, label or description."""
    services.update_meal(ctx=ctx, meal_id=meal_id, patch=_patch(body))
    return _meal(ctx, meal_id)


@router.post("/meals/{meal_id}/estimate", response_model=S.MealOut, dependencies=WRITE)
def reestimate_meal(ctx: CtxDep, meal_id: uuid.UUID, body: S.Reestimate) -> Any:
    """Re-estimate with a hint, or estimate a queued meal's description."""
    services.reestimate_meal(ctx=ctx, meal_id=meal_id, hint=body.hint)
    return _meal(ctx, meal_id)


@router.post("/meals/{meal_id}/confirm", response_model=S.MealOut, dependencies=WRITE)
def confirm_meal(ctx: CtxDep, meal_id: uuid.UUID) -> Any:
    services.confirm_meal(ctx=ctx, meal_id=meal_id)
    return _meal(ctx, meal_id)


@router.post("/meals/{meal_id}/follow-up", response_model=S.MealOut, dependencies=WRITE)
def answer_follow_up(ctx: CtxDep, meal_id: uuid.UUID, body: S.FollowUpAnswerIn) -> Any:
    services.answer_follow_up(ctx=ctx, meal_id=meal_id, option=body.option)
    return _meal(ctx, meal_id)


@router.post("/meals/{meal_id}/items", response_model=S.MealOut, dependencies=WRITE)
def add_meal_item(ctx: CtxDep, meal_id: uuid.UUID, body: S.AddMealItem) -> Any:
    services.add_meal_item(
        ctx=ctx,
        meal_id=meal_id,
        food_key=body.food_key,
        item=_draft(body.item) if body.item else None,
        item_id=body.id,
    )
    return _meal(ctx, meal_id)


@router.patch(
    "/meals/{meal_id}/items/{item_id}", response_model=S.MealOut, dependencies=WRITE
)
def patch_meal_item(
    ctx: CtxDep, meal_id: uuid.UUID, item_id: uuid.UUID, body: S.ItemPatch
) -> Any:
    """A quantity change scales the macros; macro or name edits apply as
    given (both in one request: the quantity first)."""
    patch = _patch(body)
    qty = patch.pop("qty", None)
    if qty is not None:
        services.set_item_qty(ctx=ctx, meal_id=meal_id, item_id=item_id, qty=qty)
    if patch:
        services.set_item_macros(ctx=ctx, meal_id=meal_id, item_id=item_id, patch=patch)
    if qty is None and not patch:
        owned_repo.require(ctx, Meal, meal_id, what="meal")
    return _meal(ctx, meal_id)


@router.delete(
    "/meals/{meal_id}/items/{item_id}", response_model=S.MealOut, dependencies=WRITE
)
def remove_meal_item(ctx: CtxDep, meal_id: uuid.UUID, item_id: uuid.UUID) -> Any:
    services.remove_meal_item(ctx=ctx, meal_id=meal_id, item_id=item_id)
    return _meal(ctx, meal_id)


@router.delete("/meals/{meal_id}", dependencies=WRITE)
def delete_meal(ctx: CtxDep, meal_id: uuid.UUID) -> Message:
    services.delete_meal(ctx=ctx, meal_id=meal_id)
    return Message(message="Meal deleted")


@router.post("/meals/{meal_id}/restore", response_model=S.MealOut, dependencies=WRITE)
def restore_meal(ctx: CtxDep, meal_id: uuid.UUID) -> Any:
    services.restore_meal(ctx=ctx, meal_id=meal_id)
    return _meal(ctx, meal_id)


@router.post("/meals/{meal_id}/duplicate", response_model=S.MealOut, dependencies=WRITE)
def duplicate_meal(ctx: CtxDep, meal_id: uuid.UUID, body: S.DuplicateMeal) -> Any:
    """Re-log a meal (today by default)."""
    m = services.duplicate_meal(ctx=ctx, meal_id=meal_id, day=body.day, new_id=body.id)
    return views.meal_out(ctx, m)


# --------------------------------------------------------------------------
# Settings and resets
# --------------------------------------------------------------------------


@router.get("/settings", response_model=S.FitnessSettingsPublic, dependencies=READ)
def read_settings(ctx: CtxDep) -> Any:
    """Fitness settings (FIT-22)."""
    return services.get_settings(ctx=ctx)


@router.patch("/settings", response_model=S.FitnessSettingsPublic, dependencies=WRITE)
def update_settings(ctx: CtxDep, body: S.FitnessSettingsIn) -> Any:
    return services.update_settings(ctx=ctx, patch=_patch(body))


@router.post("/reset", response_model=S.ResetOut, dependencies=WRITE)
def reset(ctx: CtxDep) -> Any:
    """Reset fitness to a new user's defaults."""
    return S.ResetOut(removed=services.reset_fitness(ctx=ctx))


@router.post("/start-fresh", response_model=S.ResetOut, dependencies=WRITE)
def start_fresh(ctx: CtxDep) -> Any:
    """Empty the logs; keep exercises, targets and settings."""
    return S.ResetOut(removed=services.start_fresh(ctx=ctx))
