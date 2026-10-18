"""Data access for the fitness module: ownership-filtered reads and the
:class:`~app.modules.fitness.calc.FitState` snapshot the calculations run on.

Every read goes through :mod:`app.shared.owned_repo`, so another user's id is
a natural 404. The snapshot holds live rows only; a tombstoned parent hides
its children even when the children themselves were never tombstoned.
"""

import uuid
from collections import defaultdict
from typing import Any

from sqlmodel import col

from app.modules.fitness import calc as C
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
from app.shared import owned_repo
from app.shared.context import Ctx


def get_settings(ctx: Ctx) -> FitnessSettings | None:
    return owned_repo.find_one(ctx, FitnessSettings, include_deleted=True)


def active_workout(ctx: Ctx) -> Workout | None:
    return owned_repo.find_one(ctx, Workout, col(Workout.status) == "in_progress")


def rest_timer(ctx: Ctx) -> RestTimer | None:
    return owned_repo.find_one(ctx, RestTimer, include_deleted=True)


def latest_weigh_in(ctx: Ctx) -> WeighIn | None:
    rows = owned_repo.list_rows(
        ctx, WeighIn, order_by=[col(WeighIn.measured_at).desc()], limit=1
    )
    return rows[0] if rows else None


def workout_exercises(ctx: Ctx, workout_id: uuid.UUID) -> list[WorkoutExercise]:
    return owned_repo.list_rows(
        ctx,
        WorkoutExercise,
        col(WorkoutExercise.workout_id) == workout_id,
        order_by=[col(WorkoutExercise.position)],
    )


def sets_of(ctx: Ctx, we_ids: list[uuid.UUID]) -> dict[uuid.UUID, list[WorkoutSet]]:
    out: dict[uuid.UUID, list[WorkoutSet]] = defaultdict(list)
    if not we_ids:
        return out
    for s in owned_repo.list_rows(
        ctx,
        WorkoutSet,
        col(WorkoutSet.workout_exercise_id).in_(we_ids),
        order_by=[col(WorkoutSet.position)],
    ):
        out[s.workout_exercise_id].append(s)
    return out


def next_position(ctx: Ctx, model: Any, parent_col: Any, parent_id: uuid.UUID) -> int:
    """One past the highest position ever used under a parent, tombstones
    included (a tombstone still holds its slot in the unique index)."""
    rows = owned_repo.list_rows(
        ctx, model, parent_col == parent_id, include_deleted=True
    )
    return max((r.position for r in rows), default=-1) + 1


def template_items(ctx: Ctx, template_id: uuid.UUID) -> list[TemplateItem]:
    return owned_repo.list_rows(
        ctx,
        TemplateItem,
        col(TemplateItem.template_id) == template_id,
        order_by=[col(TemplateItem.position)],
    )


def meal_items(ctx: Ctx, meal_id: uuid.UUID) -> list[MealItem]:
    return owned_repo.list_rows(
        ctx,
        MealItem,
        col(MealItem.meal_id) == meal_id,
        order_by=[col(MealItem.position)],
    )


def items_by_meal(
    ctx: Ctx, meal_ids: list[uuid.UUID]
) -> dict[uuid.UUID, list[MealItem]]:
    out: dict[uuid.UUID, list[MealItem]] = defaultdict(list)
    if not meal_ids:
        return out
    for it in owned_repo.list_rows(
        ctx,
        MealItem,
        col(MealItem.meal_id).in_(meal_ids),
        order_by=[col(MealItem.position)],
    ):
        out[it.meal_id].append(it)
    return out


# --------------------------------------------------------------------------
# Row -> snapshot
# --------------------------------------------------------------------------


def exercise_s(e: Exercise) -> C.ExerciseS:
    return C.ExerciseS(
        id=str(e.id),
        name=e.name,
        equipment=e.equipment,
        muscle=e.muscle,
        load_type=e.load_type,
        rep_min=e.rep_min,
        rep_max=e.rep_max,
        increment=e.increment,
        archived=e.archived,
    )


def set_s(s: WorkoutSet) -> C.SetS:
    return C.SetS(
        id=str(s.id),
        reps=s.reps,
        weight=s.weight,
        kind=s.kind,
        completed_at=s.completed_at,
    )


def workout_s(
    w: Workout,
    wes: list[WorkoutExercise],
    sets: dict[uuid.UUID, list[WorkoutSet]],
) -> C.WorkoutS:
    return C.WorkoutS(
        id=str(w.id),
        name=w.name,
        started_at=w.started_at,
        ended_at=w.ended_at,
        status=w.status,
        template_id=str(w.template_id) if w.template_id else None,
        source=w.source,
        notes=w.notes,
        exercises=[
            C.WorkoutExerciseS(
                id=str(we.id),
                exercise_id=str(we.exercise_id),
                note=we.note,
                sets=[set_s(s) for s in sets.get(we.id, [])],
            )
            for we in wes
        ],
    )


def meal_s(m: Meal, items: list[MealItem]) -> C.MealS:
    return C.MealS(
        id=str(m.id),
        eaten_at=m.eaten_at,
        label=m.label,
        status=m.status,
        source=m.source,
        raw_input=m.raw_input,
        confidence=m.confidence,
        items=[
            C.MealItemS(
                id=str(i.id),
                name=i.name,
                qty=i.qty,
                unit=i.unit,
                kcal=i.kcal,
                protein=i.protein,
                carbs=i.carbs,
                fat=i.fat,
                assumption=i.assumption,
            )
            for i in items
        ],
    )


def settings_s(st: FitnessSettings | None) -> C.SettingsS:
    if st is None or st.deleted_at is not None:
        return C.SettingsS()
    return C.SettingsS(
        units=st.units,
        rest_sec=st.rest_sec,
        weekly_target=st.weekly_target,
        progression=st.progression,
        goal_direction=st.goal_direction,
        goal_weight=st.goal_weight,
    )


def load_state(ctx: Ctx, *, meals: bool = True) -> C.FitState:
    """Every live fitness row of the caller, as a calculation snapshot."""
    exercises = owned_repo.list_rows(ctx, Exercise, order_by=[col(Exercise.name)])
    templates = owned_repo.list_rows(
        ctx,
        WorkoutTemplate,
        order_by=[col(WorkoutTemplate.sort_order), col(WorkoutTemplate.created_at)],
    )
    t_items: dict[uuid.UUID, list[TemplateItem]] = defaultdict(list)
    for ti in owned_repo.list_rows(
        ctx, TemplateItem, order_by=[col(TemplateItem.position)]
    ):
        t_items[ti.template_id].append(ti)
    workouts = owned_repo.list_rows(
        ctx,
        Workout,
        col(Workout.status) != "discarded",
        order_by=[col(Workout.started_at)],
    )
    wes: dict[uuid.UUID, list[WorkoutExercise]] = defaultdict(list)
    for we in owned_repo.list_rows(
        ctx, WorkoutExercise, order_by=[col(WorkoutExercise.position)]
    ):
        wes[we.workout_id].append(we)
    sets: dict[uuid.UUID, list[WorkoutSet]] = defaultdict(list)
    for s in owned_repo.list_rows(ctx, WorkoutSet, order_by=[col(WorkoutSet.position)]):
        sets[s.workout_exercise_id].append(s)
    meal_rows: list[Meal] = []
    m_items: dict[uuid.UUID, list[MealItem]] = defaultdict(list)
    if meals:
        meal_rows = owned_repo.list_rows(ctx, Meal, order_by=[col(Meal.eaten_at)])
        for it in owned_repo.list_rows(
            ctx, MealItem, order_by=[col(MealItem.position)]
        ):
            m_items[it.meal_id].append(it)
    return C.FitState(
        exercises=[exercise_s(e) for e in exercises],
        templates=[
            C.TemplateS(
                id=str(t.id),
                name=t.name,
                items=[
                    C.TemplateItemS(str(i.exercise_id), i.sets) for i in t_items[t.id]
                ],
            )
            for t in templates
        ],
        workouts=[workout_s(w, wes[w.id], sets) for w in workouts],
        weigh_ins=[
            C.WeighInS(
                id=str(w.id),
                measured_at=w.measured_at,
                weight_kg=w.weight_kg,
                body_fat_pct=w.body_fat_pct,
                note=w.note,
            )
            for w in owned_repo.list_rows(
                ctx, WeighIn, order_by=[col(WeighIn.measured_at)]
            )
        ],
        targets=[
            C.TargetS(
                id=str(t.id),
                effective_from=t.effective_from,
                kcal=t.kcal,
                protein=t.protein,
                carbs=t.carbs,
                fat=t.fat,
            )
            for t in owned_repo.list_rows(
                ctx, MacroTarget, order_by=[col(MacroTarget.effective_from)]
            )
        ],
        meals=[meal_s(m, m_items[m.id]) for m in meal_rows],
        settings=settings_s(get_settings(ctx)),
        clock=ctx.clock,
    )
