"""A set's weight unit and the calves/forearms muscle groups over sync:
both round-trip, the weight stays kilograms, unknown values are refused."""

import uuid
from datetime import UTC, datetime
from typing import Any

from fastapi.testclient import TestClient
from sqlmodel import Session

from tests.modules.tasks.api.helpers import op, pull, push
from tests.utils.mobile import signed_in


def rows(client: TestClient, h: dict[str, str], entity: str) -> dict[str, Any]:
    return {c["id"]: c["row"] for c in pull(client, h) if c["entity"] == entity}


def test_a_set_in_pounds_round_trips(client: TestClient, db: Session) -> None:
    _, h = signed_in(db)
    calf, grip = uuid.uuid4(), uuid.uuid4()
    w, we, st, plain = uuid.uuid4(), uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    now = datetime.now(UTC).isoformat()
    res = push(
        client,
        h,
        op(
            "upsert",
            "exercise",
            calf,
            name="Standing Calf Raise",
            equipment="machine",
            muscle="calves",
        ),
        op(
            "upsert",
            "exercise",
            grip,
            name="Wrist Curl",
            equipment="dumbbell",
            muscle="forearms",
        ),
        op(
            "upsert",
            "workout",
            w,
            name="Legs",
            started_at=now,
            ended_at=now,
            status="finished",
        ),
        op(
            "upsert",
            "workout_exercise",
            we,
            workout_id=str(w),
            exercise_id=str(calf),
            position=0,
        ),
        op(
            "upsert",
            "workout_set",
            st,
            workout_exercise_id=str(we),
            position=0,
            reps=12,
            weight=45.4,
            kind="working",
            unit="lb",
            completed_at=now,
        ),
        op(
            "upsert",
            "workout_set",
            plain,
            workout_exercise_id=str(we),
            position=1,
            reps=12,
            weight=45,
            kind="working",
            completed_at=now,
        ),
    )
    assert [r["status"] for r in res] == ["applied"] * 6, res
    ex = rows(client, h, "exercise")
    assert (ex[str(calf)]["muscle"], ex[str(grip)]["muscle"]) == ("calves", "forearms")
    sets = rows(client, h, "workout_set")
    assert (sets[str(st)]["unit"], sets[str(st)]["weight"]) == ("lb", 45.4)
    assert sets[str(plain)]["unit"] is None

    bad = push(
        client,
        h,
        op("upsert", "workout_set", st, unit="stone"),
        op("upsert", "exercise", calf, muscle="neck"),
    )
    assert [r["status"] for r in bad] == ["rejected"] * 2, bad
