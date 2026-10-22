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


def test_nutrition_today_plans_the_meals_still_ahead(db: Session) -> None:
    """After breakfast at 08:00 Manila time, lunch and dinner are ahead: the
    rest of the day splits across them, with the room left under each
    limit, and foods eaten lately to suggest from."""
    from datetime import datetime, timezone

    user, _ = signed_in(db)
    # 08:00 in Asia/Manila (UTC+8), well after the 04:00 day start.
    morning = datetime(2026, 10, 22, 0, 0, tzinfo=timezone.utc)
    with ctx_for(user, now=morning) as ctx:
        svc.set_macro_target(ctx=ctx, kcal=2000, protein=150, carbs=200, fat=60)
    with ctx_for(user, now=morning) as ctx:
        public.log_meal(
            ctx,
            public.MealDraft(
                raw="Breakfast: tapsilog",
                label="breakfast",
                items=[
                    public.MealItemDraft(
                        name="Tapsilog",
                        qty=1,
                        unit="plate",
                        kcal=800,
                        protein=40,
                        carbs=90,
                        fat=30,
                        sat_fat=10,
                        sodium=1200,
                    )
                ],
                confidence=1,
                source="manual",
                eaten_at=morning,
            ),
        )
        day = public.nutrition_today(ctx)
    assert day["meals_ahead"] == ["lunch", "dinner"]
    # 1,200 kcal, 110 g protein, 110 g carbs and 30 g fat left, in two.
    per = day["per_meal_ahead"]
    assert (per["kcal"], per["protein"], per["carbs"], per["fat"]) == (600, 55, 55, 15)
    # Default limits: 20 g saturated fat, 2,000 mg sodium.
    assert day["limits_left"]["sat_fat_left_g"] == 10
    assert day["limits_left"]["sodium_left_mg"] == 800
    assert per["sat_fat_left_g"] == 5
    assert day["recent_foods"] == ["Tapsilog"]


def test_late_at_night_no_meal_is_ahead(db: Session) -> None:
    from datetime import datetime, timezone

    user, _ = signed_in(db)
    late = datetime(2026, 10, 22, 15, 0, tzinfo=timezone.utc)  # 23:00 Manila
    with ctx_for(user, now=late) as ctx:
        svc.set_macro_target(ctx=ctx, kcal=2000, protein=150, carbs=200, fat=60)
    with ctx_for(user, now=late) as ctx:
        day = public.nutrition_today(ctx)
    assert day["meals_ahead"] == []
    assert "per_meal_ahead" not in day
