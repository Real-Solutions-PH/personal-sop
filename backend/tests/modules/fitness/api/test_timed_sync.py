"""Timed exercises over sync: a cardio exercise that tracks speed, a
template goal, and a timed set's duration and speed round-trip; values out
of range are refused."""

import uuid
from datetime import UTC, datetime
from typing import Any

from fastapi.testclient import TestClient
from sqlmodel import Session

from tests.modules.tasks.api.helpers import op, pull, push
from tests.utils.mobile import signed_in


def rows(client: TestClient, h: dict[str, str], entity: str) -> dict[str, Any]:
    return {c["id"]: c["row"] for c in pull(client, h) if c["entity"] == entity}


def test_a_timed_walk_round_trips(client: TestClient, db: Session) -> None:
    _, h = signed_in(db)
    walk, tpl, item = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    w, we, st = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    now = datetime.now(UTC).isoformat()
    res = push(
        client,
        h,
        op(
            "upsert",
            "exercise",
            walk,
            name="Incline Walk",
            equipment="machine",
            muscle="cardio",
            load_type="time",
            track="speed",
        ),
        op("upsert", "workout_template", tpl, name="Upper", sort_order=0),
        op(
            "upsert",
            "template_item",
            item,
            template_id=str(tpl),
            exercise_id=str(walk),
            position=0,
            sets=1,
            target_sec=1200,
        ),
        op(
            "upsert",
            "workout",
            w,
            name="Upper",
            started_at=now,
            ended_at=now,
            status="finished",
        ),
        op(
            "upsert",
            "workout_exercise",
            we,
            workout_id=str(w),
            exercise_id=str(walk),
            position=0,
        ),
        op(
            "upsert",
            "workout_set",
            st,
            workout_exercise_id=str(we),
            position=0,
            reps=0,
            weight=0,
            kind="working",
            duration_sec=1080,
            speed_kmh=5.5,
            completed_at=now,
        ),
    )
    assert [r["status"] for r in res] == ["applied"] * 6, res
    assert rows(client, h, "exercise")[str(walk)]["track"] == "speed"
    assert rows(client, h, "template_item")[str(item)]["target_sec"] == 1200
    s = rows(client, h, "workout_set")[str(st)]
    assert (s["duration_sec"], s["speed_kmh"]) == (1080, 5.5)

    bad = push(
        client,
        h,
        op("upsert", "workout_set", st, speed_kmh=99),
        op("upsert", "template_item", item, target_sec=0),
        op("upsert", "exercise", walk, track="distance"),
    )
    assert [r["status"] for r in bad] == ["rejected"] * 3, bad
