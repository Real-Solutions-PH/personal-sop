"""The fitness entities and actions through ``/sync/push`` and ``/sync/pull``."""

import uuid
from datetime import datetime, timedelta
from typing import Any

from fastapi.testclient import TestClient
from sqlmodel import Session

from app.core.config import settings
from app.shared.owned import utcnow
from tests.modules.fitness.api.helpers import API, exercise_ids, ok
from tests.utils.mobile import signed_in

SYNC = f"{settings.API_V1_STR}/sync"


def op(kind: str, target: str, row_id: Any = None, **data: Any) -> dict[str, Any]:
    return {
        "op_id": str(uuid.uuid4()),
        "kind": kind,
        "name": target,
        "id": str(row_id) if row_id else None,
        "data": data,
    }


def push(
    client: TestClient, h: dict[str, str], *ops: dict[str, Any]
) -> list[dict[str, Any]]:
    return list(
        ok(client.post(f"{SYNC}/push", headers=h, json={"ops": list(ops)}))["results"]
    )


def pull_all(client: TestClient, h: dict[str, str]) -> list[dict[str, Any]]:
    changes: list[dict[str, Any]] = []
    cursor = 0
    while True:
        page = ok(client.get(f"{SYNC}/pull?cursor={cursor}&limit=200", headers=h))
        changes += page["changes"]
        cursor = page["cursor"]
        if not page["truncated"]:
            return changes


def _iso(days: int = 0) -> str:
    return (utcnow() - timedelta(days=days)).isoformat()


def test_every_entity_pushes_and_pulls(client: TestClient, db: Session) -> None:
    _, h = signed_in(db)
    ids = {
        k: uuid.uuid4()
        for k in ("ex", "tpl", "ti", "w", "we", "set", "wi", "mt", "meal", "mi", "st")
    }
    res = push(
        client,
        h,
        op(
            "upsert",
            "exercise",
            ids["ex"],
            name="Hip Thrust",
            equipment="barbell",
            muscle="glutes",
        ),
        op("upsert", "workout_template", ids["tpl"], name="Glutes"),
        op(
            "upsert",
            "template_item",
            ids["ti"],
            template_id=str(ids["tpl"]),
            exercise_id=str(ids["ex"]),
            position=0,
            sets=4,
        ),
        op(
            "upsert",
            "workout",
            ids["w"],
            name="Backfill",
            started_at=_iso(1),
            ended_at=_iso(0),
        ),
        op(
            "upsert",
            "workout_exercise",
            ids["we"],
            workout_id=str(ids["w"]),
            exercise_id=str(ids["ex"]),
            position=0,
        ),
        op(
            "upsert",
            "workout_set",
            ids["set"],
            workout_exercise_id=str(ids["we"]),
            position=0,
            reps=8,
            weight=100,
            completed_at=_iso(1),
        ),
        op("upsert", "weigh_in", ids["wi"], measured_at=_iso(0), weight_kg=80.2),
        op(
            "upsert",
            "macro_target",
            ids["mt"],
            effective_from=str(utcnow().date()),
            kcal=2000,
            protein=150,
            carbs=200,
            fat=60,
        ),
        op(
            "upsert",
            "meal",
            ids["meal"],
            eaten_at=_iso(0),
            label="lunch",
            status="confirmed",
        ),
        op(
            "upsert",
            "meal_item",
            ids["mi"],
            meal_id=str(ids["meal"]),
            name="Rice",
            qty=1,
            unit="cup",
            kcal=205,
            protein=4,
            carbs=45,
            fat=0,
        ),
        op("upsert", "fitness_settings", ids["st"], weekly_target=3),
    )
    assert [r["status"] for r in res] == ["applied"] * 11, res
    assert res[3]["row"]["status"] == "finished"
    entities = {c["entity"] for c in pull_all(client, h)}
    assert entities >= {
        "exercise",
        "workout_template",
        "template_item",
        "workout",
        "workout_exercise",
        "workout_set",
        "weigh_in",
        "macro_target",
        "meal",
        "meal_item",
        "fitness_settings",
    }
    # The settings op wrote the user's one row whatever id it carried.
    assert ok(client.get(f"{API}/settings", headers=h))["weekly_target"] == 3
    # Field-level LWW: a partial op changes one field.
    upd = push(client, h, op("upsert", "meal_item", ids["mi"], qty=2))[0]
    assert (upd["row"]["qty"], upd["row"]["name"]) == (2, "Rice")


def test_replay_and_tombstone(client: TestClient, db: Session) -> None:
    _, h = signed_in(db)
    wi = uuid.uuid4()
    create = op("upsert", "weigh_in", wi, measured_at=_iso(0), weight_kg=81)
    first = push(client, h, create)[0]
    again = push(client, h, create)[0]
    assert again["replayed"] is True and again["row"] == first["row"]
    assert push(client, h, op("delete", "weigh_in", wi))[0]["status"] == "applied"
    gone = [c for c in pull_all(client, h) if c["id"] == str(wi)]
    assert gone[-1]["deleted"] is True and gone[-1]["row"] is None
    stale = push(client, h, op("upsert", "weigh_in", wi, weight_kg=82))[0]
    assert (stale["status"], stale["code"]) == ("conflict", "deleted_on_server")
    restored = push(client, h, op("upsert", "weigh_in", wi, deleted_at=None))[0]
    assert restored["status"] == "applied"


def test_rules_guard_synced_writes(client: TestClient, db: Session) -> None:
    _, h1 = signed_in(db)
    _, h2 = signed_in(db)
    foreign_tpl = ok(client.get(f"{API}/templates", headers=h1))["data"][0]["id"]
    foreign_ex = exercise_ids(client, h1)["Back Squat"]
    w = uuid.uuid4()
    res = push(
        client,
        h2,
        op(
            "upsert",
            "template_item",
            uuid.uuid4(),
            template_id=foreign_tpl,
            exercise_id=foreign_ex,
            position=9,
        ),
        op(
            "upsert",
            "workout",
            uuid.uuid4(),
            name="Live",
            started_at=_iso(0),
            ended_at=_iso(0),
            status="in_progress",
        ),
        op("upsert", "workout", w, name="Done", started_at=_iso(1), ended_at=_iso(0)),
        op("upsert", "workout", w, status="in_progress"),
        op(
            "upsert",
            "workout",
            uuid.uuid4(),
            name="Backwards",
            started_at=_iso(0),
            ended_at=_iso(1),
        ),
        op(
            "upsert",
            "exercise",
            uuid.uuid4(),
            name="Bad",
            equipment="barbell",
            muscle="chest",
            rep_min=10,
            rep_max=5,
        ),
        op("upsert", "rest_timer", uuid.uuid4()),
        op(
            "upsert",
            "meal_item",
            uuid.uuid4(),
            meal_id=str(uuid.uuid4()),
            name="x",
            qty=1,
            unit="g",
            kcal=1,
            protein=1,
            carbs=1,
            fat=1,
        ),
        op(
            "upsert",
            "workout_set",
            uuid.uuid4(),
            workout_exercise_id=str(uuid.uuid4()),
            position=0,
        ),
        op("upsert", "exercise", uuid.uuid4(), name="No muscle"),
    )
    got = [(r["status"], r["code"]) for r in res]
    assert got == [
        ("rejected", "template_not_found"),
        ("rejected", "use_start_action"),
        ("applied", None),
        ("rejected", "use_finish_action"),
        ("rejected", "end_before_start"),
        ("rejected", "invalid_rep_range"),
        ("rejected", "unknown_entity"),
        ("rejected", "meal_not_found"),
        ("rejected", "workout_exercise_not_found"),
        ("rejected", "missing_fields"),
    ]


def test_workout_actions(client: TestClient, db: Session) -> None:
    _, h = signed_in(db)
    ids = exercise_ids(client, h)
    wid = uuid.uuid4()
    started = push(
        client, h, op("action", "fitness.start_workout", workout_id=str(wid))
    )[0]
    assert started["status"] == "applied" and started["result"]["workout"]["id"] == str(
        wid
    )
    assert started["result"]["resumed"] is False
    w = ok(
        client.post(
            f"{API}/workouts/{wid}/exercises",
            headers=h,
            json={"exercise_ids": [ids["Barbell Row"]]},
        )
    )
    we = w["exercises"][0]
    tog = push(
        client,
        h,
        op(
            "action",
            "fitness.toggle_set",
            workout_id=str(wid),
            workout_exercise_id=we["id"],
            set_id=we["sets"][0]["id"],
        ),
        op("action", "fitness.rest.adjust", delta=30),
    )
    assert (
        tog[0]["result"]["completed"] is True
        and tog[0]["result"]["rest"]["duration_sec"] == 120
    )
    assert tog[1]["result"]["rest"]["duration_sec"] == 150
    rest = push(
        client,
        h,
        op("action", "fitness.rest.start", sec=60),
        op("action", "fitness.rest.skip"),
    )
    assert (
        rest[0]["result"]["rest"]["duration_sec"] == 60
        and rest[1]["status"] == "applied"
    )
    pulled = [c for c in pull_all(client, h) if c["entity"] == "rest_timer"]
    assert pulled[-1]["deleted"] is True
    # Replaying the start returns the same workout; discard ends it.
    again = push(
        client, h, op("action", "fitness.start_workout", workout_id=str(uuid.uuid4()))
    )[0]
    assert again["result"]["resumed"] is True and again["result"]["workout"][
        "id"
    ] == str(wid)
    assert (
        push(client, h, op("action", "fitness.discard_workout", workout_id=str(wid)))[
            0
        ]["status"]
        == "applied"
    )
    bad = push(client, h, op("action", "fitness.discard_workout", workout_id=str(wid)))[
        0
    ]
    assert (bad["status"], bad["code"]) == ("rejected", "workout_not_found")


def test_finish_action(client: TestClient, db: Session) -> None:
    _, h = signed_in(db)
    wid = uuid.uuid4()
    push(client, h, op("action", "fitness.start_workout", workout_id=str(wid)))
    done = push(
        client,
        h,
        op("action", "fitness.finish_workout", workout_id=str(wid), unfinished="done"),
    )[0]
    assert (
        done["status"] == "applied"
        and done["result"]["workout"]["status"] == "finished"
    )


def test_meal_actions(client: TestClient, db: Session) -> None:
    _, h = signed_in(db)
    m = ok(
        client.post(f"{API}/meals/estimate", headers=h, json={"text": "rice and adobo"})
    )
    fu = push(
        client,
        h,
        op("action", "fitness.answer_follow_up", meal_id=m["id"], option="1.5 cups"),
    )[0]
    rice = next(i for i in fu["result"]["items"] if i["name"] == "Steamed rice")
    assert (rice["qty"], rice["kcal"]) == (1.5, 308)
    assert fu["result"]["meal"]["follow_up"] is None
    conf = push(client, h, op("action", "fitness.confirm_meal", meal_id=m["id"]))[0]
    assert conf["result"]["meal"]["status"] == "confirmed"
    bad = push(
        client, h, op("action", "fitness.answer_follow_up", meal_id=m["id"], option="")
    )[0]
    assert (bad["status"], bad["code"]) == ("rejected", "validation_error")


def test_rest_timer_round_trips_through_its_actions(
    client: TestClient, db: Session
) -> None:
    """rest_timer is a synced table written only by the fitness.rest.*
    actions: each action's effect comes back on the next pull, and a field
    write stays refused (the device's mapper sends none)."""
    _, h = signed_in(db)

    def last_rest() -> dict[str, Any]:
        rows = [c for c in pull_all(client, h) if c["entity"] == "rest_timer"]
        assert len({c["id"] for c in rows}) == 1, "one timer row per user"
        return rows[-1]

    started = push(client, h, op("action", "fitness.rest.start", sec=90))[0]
    assert started["status"] == "applied"
    first = last_rest()
    assert first["deleted"] is False and first["row"]["duration_sec"] == 90
    assert first["row"]["ends_at"] == started["result"]["rest"]["ends_at"]

    assert (
        push(client, h, op("action", "fitness.rest.adjust", delta=-15))[0]["status"]
        == "applied"
    )
    adjusted = last_rest()
    assert adjusted["id"] == first["id"] and adjusted["row"]["duration_sec"] == 75

    refused = push(client, h, op("upsert", "rest_timer", first["id"], duration_sec=5))[
        0
    ]
    assert (refused["status"], refused["code"]) == ("rejected", "unknown_entity")
    assert last_rest()["row"]["duration_sec"] == 75

    assert push(client, h, op("action", "fitness.rest.skip"))[0]["status"] == "applied"
    assert last_rest()["deleted"] is True


def _at(op_: dict[str, Any], when: datetime) -> dict[str, Any]:
    return {**op_, "at": when.isoformat()}


def _instant(v: str) -> datetime:
    return datetime.fromisoformat(v.replace("Z", "+00:00"))


def test_queued_ops_apply_as_of_when_the_person_made_them(
    client: TestClient, db: Session
) -> None:
    """A workout logged on a slow or offline link reaches the server minutes
    later; the start, the tick and the rest it started keep the phone's
    times, so the pull that follows matches what the phone already shows."""
    _, h = signed_in(db)
    ids = exercise_ids(client, h)
    t0 = utcnow().replace(microsecond=0) - timedelta(minutes=40)
    t1 = t0 + timedelta(minutes=3)
    wid, weid, sid = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    res = push(
        client,
        h,
        _at(op("action", "fitness.start_workout", workout_id=str(wid)), t0),
        _at(
            op(
                "upsert",
                "workout_exercise",
                weid,
                workout_id=str(wid),
                exercise_id=ids["Barbell Row"],
                position=0,
            ),
            t0,
        ),
        _at(
            op(
                "upsert",
                "workout_set",
                sid,
                workout_exercise_id=str(weid),
                position=0,
                reps=8,
                weight=60,
            ),
            t0,
        ),
        _at(
            op(
                "action",
                "fitness.toggle_set",
                workout_id=str(wid),
                workout_exercise_id=str(weid),
                set_id=str(sid),
            ),
            t1,
        ),
        _at(op("action", "fitness.rest.start", sec=90), t1),
    )
    assert [r["status"] for r in res] == ["applied"] * 5
    assert _instant(res[0]["result"]["workout"]["started_at"]) == t0
    assert _instant(res[3]["result"]["set"]["completed_at"]) == t1
    assert _instant(res[4]["result"]["rest"]["ends_at"]) == t1 + timedelta(seconds=90)
    rows = {(c["entity"], c["id"]): c for c in pull_all(client, h)}
    assert _instant(rows[("workout", str(wid))]["row"]["started_at"]) == t0
    assert _instant(rows[("workout_set", str(sid))]["row"]["completed_at"]) == t1


def test_an_implausible_device_time_falls_back_to_the_servers(
    client: TestClient, db: Session
) -> None:
    _, h = signed_in(db)
    before = utcnow()
    ahead = push(
        client,
        h,
        _at(op("action", "fitness.rest.start", sec=60), before + timedelta(hours=2)),
    )[0]
    ends = _instant(ahead["result"]["rest"]["ends_at"])
    assert before + timedelta(seconds=60) <= ends <= utcnow() + timedelta(seconds=60)
    stale = push(
        client,
        h,
        _at(op("action", "fitness.rest.start", sec=60), before - timedelta(days=45)),
    )[0]
    assert _instant(stale["result"]["rest"]["ends_at"]) >= before + timedelta(
        seconds=60
    )


def test_target_adjustment_is_one_row_per_day_near_today(
    client: TestClient, db: Session
) -> None:
    _, h = signed_in(db)
    today = utcnow().date()
    first = push(
        client,
        h,
        op("upsert", "target_adjustment", uuid.uuid4(), day=str(today), kcal=300),
    )[0]
    assert first["status"] == "applied" and first["row"]["kcal"] == 300
    # A second device's row for the same day lands on the same row.
    again = push(
        client,
        h,
        op("upsert", "target_adjustment", uuid.uuid4(), day=str(today), kcal=450),
    )[0]
    assert again["row"]["id"] == first["row"]["id"]
    assert again["row"]["kcal"] == 450
    far = [
        push(
            client,
            h,
            op(
                "upsert",
                "target_adjustment",
                uuid.uuid4(),
                day=str(today + timedelta(days=d)),
                kcal=100,
            ),
        )[0]
        # ±3: the UTC date used here is within a day of the server's own
        # business day (Manila, 04:00 rollover), so ±2 could land on ±1.
        for d in (3, -3)
    ]
    assert [(r["status"], r["code"]) for r in far] == [
        ("rejected", "adjustment_day_out_of_range")
    ] * 2
