"""Shared helpers for the fitness integration tests."""

import uuid
from datetime import datetime, timedelta
from typing import Any

from fastapi.testclient import TestClient

from app.core.config import settings
from app.modules.fitness.models import Workout, WorkoutExercise, WorkoutSet
from app.modules.iam.users.models import User
from app.shared import owned_repo
from tests.utils.mobile import ctx_for

API = f"{settings.API_V1_STR}/fitness"


def ok(r: Any, status: int = 200) -> Any:
    assert r.status_code == status, r.text
    return r.json()


def err(r: Any, status: int, code: str) -> None:
    assert r.status_code == status, r.text
    assert r.json()["code"] == code, r.text


def exercise_ids(client: TestClient, headers: dict[str, str]) -> dict[str, str]:
    """Name -> id of the seeded library."""
    data = ok(client.get(f"{API}/exercises?include_archived=true", headers=headers))
    return {e["name"]: e["id"] for e in data["data"]}


def finished_workout(
    user: User,
    *,
    started_at: datetime,
    lifts: list[tuple[uuid.UUID, list[tuple[int, float]]]],
    name: str = "Logged",
    template_id: uuid.UUID | None = None,
) -> uuid.UUID:
    """A finished workout written straight to the database (the finish use
    case needs the habits module, which is a stub on this branch)."""
    with ctx_for(user) as ctx:
        w = owned_repo.insert(
            ctx,
            Workout,
            {
                "name": name,
                "started_at": started_at,
                "ended_at": started_at + timedelta(minutes=50),
                "status": "finished",
                "template_id": template_id,
            },
        )
        for pos, (ex_id, sets) in enumerate(lifts):
            we = owned_repo.insert(
                ctx,
                WorkoutExercise,
                {"workout_id": w.id, "exercise_id": ex_id, "position": pos},
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
                        "completed_at": started_at + timedelta(minutes=5 + i),
                    },
                )
        ctx.session.commit()
        return w.id
