"""The reads capture makes through fitness' ``public.py``, and the workout
draft's day ("swam 30 min yesterday" lands yesterday)."""

import uuid
from datetime import timedelta

from sqlmodel import Session

from app.modules.fitness import calc, public
from app.modules.fitness import services as svc
from tests.utils.mobile import ctx_for, signed_in


def test_workout_draft_day_and_finished_count(db: Session) -> None:
    user, _ = signed_in(db)
    wid = uuid.uuid4()
    with ctx_for(user) as ctx:
        yesterday = ctx.today - timedelta(days=1)
        week_ago = ctx.now - timedelta(days=7)
        assert public.count_finished_workouts_since(ctx, since=week_ago) == 0
        w = public.log_workout_from_chat(
            ctx,
            public.WorkoutDraft(
                name="Swim",
                cardio={"kind": "swim", "minutes": 30},
                workout_id=wid,
                day=yesterday,
            ),
        )
        assert w.id == wid
        assert ctx.clock.day_of(w.started_at) == yesterday
        assert w.started_at == ctx.clock.local_time(yesterday, "18:30")
        # No day: today, as before the field existed.
        today_w = public.log_workout_from_chat(
            ctx,
            public.WorkoutDraft(
                name="Push",
                exercises=[
                    public.ExerciseDraft(
                        exercise="Bench press", sets=[public.SetDraft(5, 60.0)]
                    )
                ],
            ),
        )
        assert ctx.clock.day_of(today_w.started_at) == ctx.today
        assert public.count_finished_workouts_since(ctx, since=week_ago) == 2
        # Strictly after ``since``.
        assert public.count_finished_workouts_since(ctx, since=today_w.started_at) == 0
        assert (
            public.count_finished_workouts_since(
                ctx, since=w.started_at - timedelta(seconds=1)
            )
            == 2
        )


def test_macros_left_and_state(db: Session) -> None:
    user, _ = signed_in(db)
    with ctx_for(user) as ctx:
        assert public.macros_left(ctx, day=ctx.today) is None
        svc.set_macro_target(ctx=ctx, kcal=2000, protein=150, carbs=200, fat=60)
    with ctx_for(user) as ctx:
        public.log_meal(
            ctx,
            public.MealDraft(
                raw="rice and chicken",
                items=[
                    public.MealItemDraft(
                        name="chicken",
                        qty=1,
                        unit="pc",
                        kcal=500,
                        protein=40,
                        carbs=50,
                        fat=15,
                    )
                ],
                confidence=1,
                source="manual",
                eaten_at=ctx.now,
            ),
        )
        left = public.macros_left(ctx, day=ctx.today)
        assert left is not None
        assert (left.kcal, left.protein, left.carbs, left.fat) == (1500, 110, 150, 45)

        s = public.load_state(ctx)
        assert isinstance(s, calc.FitState)
        assert len(s.meals) == 1
        assert public.calc is calc
