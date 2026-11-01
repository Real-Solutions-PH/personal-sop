"""A workout's estimated active kcal and steps: written by the device over
sync, and estimated by the server when a workout finishes without one."""

import uuid
from datetime import timedelta
from typing import Any

from fastapi.testclient import TestClient
from sqlmodel import Session

from app.modules.fitness import services
from app.modules.fitness.models import WeighIn, Workout, WorkoutExercise, WorkoutSet
from app.modules.iam.users.models import User
from app.shared import owned_repo
from app.shared.owned import utcnow
from tests.modules.fitness.api.helpers import exercise_ids
from tests.modules.tasks.api.helpers import op, pull, push
from tests.utils.mobile import ctx_for, signed_in


def _rows(client: TestClient, h: dict[str, str], entity: str) -> dict[str, Any]:
    return {c["id"]: c["row"] for c in pull(client, h) if c["entity"] == entity}


def test_kcal_and_steps_sync_as_plain_fields(client: TestClient, db: Session) -> None:
    _, h = signed_in(db)
    w = uuid.uuid4()
    start = utcnow() - timedelta(hours=2)
    res = push(
        client,
        h,
        op(
            "upsert",
            "workout",
            w,
            name="Legs",
            started_at=start.isoformat(),
            ended_at=(start + timedelta(minutes=50)).isoformat(),
            kcal=312.5,
            steps=4200,
        ),
    )
    assert res[0]["status"] == "applied", res
    assert (res[0]["row"]["kcal"], res[0]["row"]["steps"]) == (312.5, 4200)
    # A later write of one field leaves the other alone.
    upd = push(client, h, op("upsert", "workout", w, steps=4300))[0]
    assert (upd["row"]["kcal"], upd["row"]["steps"]) == (312.5, 4300)
    row = _rows(client, h, "workout")[str(w)]
    assert (row["kcal"], row["steps"]) == (312.5, 4300)

    bad = push(
        client,
        h,
        op("upsert", "workout", w, kcal=20001),
        op("upsert", "workout", w, kcal=-1),
        op("upsert", "workout", w, steps=300001),
        op("upsert", "workout", w, steps=-1),
    )
    assert [r["status"] for r in bad] == ["rejected"] * 4, bad


def _in_progress(
    user: User, *, minutes_ago: int, working: int, kcal: float | None = None
) -> uuid.UUID:
    with ctx_for(user) as ctx:
        start = ctx.now - timedelta(minutes=minutes_ago)
        ex = services.catalog_exercises(ctx)[0]
        w = owned_repo.insert(
            ctx,
            Workout,
            {
                "name": "Push",
                "started_at": start,
                "status": "in_progress",
                "kcal": kcal,
            },
        )
        we = owned_repo.insert(
            ctx,
            WorkoutExercise,
            {"workout_id": w.id, "exercise_id": ex.id, "position": 0},
        )
        for i in range(working):
            owned_repo.insert(
                ctx,
                WorkoutSet,
                {
                    "workout_exercise_id": we.id,
                    "position": i,
                    "reps": 8,
                    "weight": 60,
                    "completed_at": start + timedelta(minutes=2 + i),
                },
            )
        ctx.session.commit()
        return w.id


def _weigh(user: User, kg: float, days_ago: float) -> None:
    with ctx_for(user) as ctx:
        owned_repo.insert(
            ctx,
            WeighIn,
            {"measured_at": ctx.now - timedelta(days=days_ago), "weight_kg": kg},
        )
        ctx.session.commit()


def test_finish_estimates_kcal_when_the_device_sent_none(
    client: TestClient, db: Session
) -> None:
    user, h = signed_in(db)
    exercise_ids(client, h)  # seeds the library
    _weigh(user, 80.0, days_ago=1)
    wid = _in_progress(user, minutes_ago=60, working=12)
    with ctx_for(user) as ctx:
        w = owned_repo.require(ctx, Workout, wid, what="workout")
        end = w.started_at + timedelta(minutes=45)
        done = services.finish_workout(ctx=ctx, workout_id=wid, end_at=end)
        # 45 min, 12 working sets, 80 kg: density 12 / 45 * 10 = 2.67 -> MET
        # 3.5; (3.5 - 1) * 80 * 45 / 60 = 150.
        assert done.kcal == 150


def test_finish_keeps_the_kcal_the_device_wrote(
    client: TestClient, db: Session
) -> None:
    user, h = signed_in(db)
    exercise_ids(client, h)
    wid = _in_progress(user, minutes_ago=60, working=12, kcal=321.0)
    with ctx_for(user) as ctx:
        done = services.finish_workout(ctx=ctx, workout_id=wid)
        assert done.kcal == 321.0


def test_a_chat_logged_workout_gets_an_estimate(
    client: TestClient, db: Session
) -> None:
    user, h = signed_in(db)
    exercise_ids(client, h)
    with ctx_for(user) as ctx:
        w = services.log_workout_from_chat(
            ctx,
            name="Chest day",
            exercises=[
                ("Barbell Bench Press", [(8, 60.0)] * 4),
                ("Incline Dumbbell Press", [(10, 22.0)] * 4),
                ("Cable Fly", [(12, 15.0)] * 4),
            ],
        )
        ctx.session.commit()
        # Chat: 12 working sets -> remainder 12 * 2.5 = 30 min; density
        # 12 / 30 * 10 = 4 -> MET 5.0; no weigh-in -> 70 kg;
        # (5 - 1) * 70 * 30 / 60 = 140.
        assert w.kcal == 140
