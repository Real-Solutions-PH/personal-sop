"""Routines, the habit timer, the Live bar and the routine-run state machine
over HTTP."""

import uuid
from typing import Any

from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.modules.habits.models import RoutineStepResult
from tests.modules.habits.api.util import API, err, make_habit, ok
from tests.utils.mobile import signed_in


def _routine(client: TestClient, h: dict[str, str], steps: list[dict[str, Any]]) -> Any:
    return ok(
        client.post(
            f"{API}/routines",
            headers=h,
            json={
                "name": "Morning",
                "schedule": [{"days": [0, 1, 2, 3, 4, 5, 6]}],
                "steps": steps,
            },
        )
    )


def test_routine_crud_and_steps(client: TestClient, db: Session) -> None:
    _, h = signed_in(db)
    a = make_habit(client, h, name="Water")["id"]
    b = make_habit(client, h, name="Stretch")["id"]
    r = _routine(
        client, h, [{"habit_id": a, "minutes": 2}, {"habit_id": b, "minutes": 10}]
    )
    rid = r["id"]
    detail = ok(client.get(f"{API}/routines/{rid}", headers=h))
    assert [(s["name"], s["minutes"]) for s in detail["steps"]] == [
        ("Water", 2),
        ("Stretch", 10),
    ]
    assert detail["planned_min"] == 12

    steps = ok(
        client.put(
            f"{API}/routines/{rid}/steps",
            headers=h,
            json={"steps": [{"habit_id": b, "minutes": 5}]},
        )
    )
    assert [(s["habit_id"], s["position"]) for s in steps] == [(b, 0)]
    # Growing again reuses the tombstoned position row (unique per routine).
    steps = ok(
        client.put(
            f"{API}/routines/{rid}/steps",
            headers=h,
            json={
                "steps": [{"habit_id": b, "minutes": 5}, {"habit_id": a, "minutes": 1}]
            },
        )
    )
    assert [s["position"] for s in steps] == [0, 1]
    err(
        client.put(
            f"{API}/routines/{rid}/steps",
            headers=h,
            json={"steps": [{"habit_id": str(uuid.uuid4()), "minutes": 5}]},
        ),
        404,
        "habit_not_found",
    )
    err(
        client.put(
            f"{API}/routines/{rid}/steps",
            headers=h,
            json={"steps": [{"habit_id": a, "minutes": 0}]},
        ),
        422,
    )

    ok(client.patch(f"{API}/routines/{rid}", headers=h, json={"name": "AM"}))
    ok(client.post(f"{API}/routines/{rid}/archive", headers=h))
    assert ok(client.get(f"{API}/routines", headers=h))["count"] == 0
    assert (
        ok(client.get(f"{API}/routines", headers=h, params={"archived": True}))["count"]
        == 1
    )
    ok(client.post(f"{API}/routines/{rid}/restore", headers=h))
    # Deleting a habit drops it from the routine; the rest close ranks.
    ok(client.delete(f"{API}/{b}", headers=h))
    detail = ok(client.get(f"{API}/routines/{rid}", headers=h))
    assert [(s["habit_id"], s["position"]) for s in detail["steps"]] == [(a, 0)]

    ok(client.delete(f"{API}/routines/{rid}", headers=h))
    err(client.get(f"{API}/routines/{rid}", headers=h), 404)
    assert ok(client.get(f"{API}/{a}", headers=h))["habit"]["name"] == "Water"

    _, other = signed_in(db)
    err(client.get(f"{API}/routines/{r['id']}", headers=other), 404)


def test_timer_finish_logs_done_or_partial(client: TestClient, db: Session) -> None:
    _, h = signed_in(db)
    hid = make_habit(client, h, name="Meditate", type="duration", target=10)["id"]
    t = ok(client.post(f"{API}/{hid}/timer", headers=h))
    assert t["target_sec"] == 600
    # Starting the same habit's timer again is idempotent.
    assert ok(client.post(f"{API}/{hid}/timer", headers=h))["id"] == t["id"]
    assert (
        ok(client.post(f"{API}/timer/extend", headers=h, json={"sec": 300}))[
            "target_sec"
        ]
        == 900
    )
    paused = ok(client.post(f"{API}/timer/pause", headers=h))
    assert paused["paused_at"] is not None
    assert ok(client.post(f"{API}/timer/resume", headers=h))["paused_at"] is None

    done = ok(client.post(f"{API}/timer/finish", headers=h, json={"minutes": 12.4}))
    assert (done["log"]["status"], done["log"]["value"], done["log"]["source"]) == (
        "done",
        12,
        "timer",
    )
    assert ok(client.get(f"{API}/timer", headers=h))["timer"] is None
    err(client.post(f"{API}/timer/finish", headers=h, json={}), 404, "timer_not_found")

    ok(client.post(f"{API}/{hid}/timer", headers=h))
    partial = ok(client.post(f"{API}/timer/finish", headers=h, json={"minutes": 4}))
    assert (partial["log"]["status"], partial["log"]["value"]) == ("partial", 4)
    assert partial["log"]["id"] == done["log"]["id"]  # same (habit, day) row

    ok(client.post(f"{API}/{hid}/timer", headers=h))
    ok(client.post(f"{API}/timer/discard", headers=h))
    assert ok(client.get(f"{API}/timer", headers=h))["timer"] is None


def test_live_bar_conflict(client: TestClient, db: Session) -> None:
    _, h = signed_in(db)
    a = make_habit(client, h, name="Read", type="duration", target=20)["id"]
    b = make_habit(client, h, name="Write", type="duration", target=20)["id"]
    rid = _routine(client, h, [{"habit_id": a, "minutes": 5}])["id"]

    ok(client.post(f"{API}/{a}/timer", headers=h))
    busy = err(client.post(f"{API}/{b}/timer", headers=h), 409, "live_session_busy")
    assert busy["details"]["kind"] == "timer"
    assert busy["details"]["href"] == f"/habits/{a}/timer"
    err(client.post(f"{API}/routines/{rid}/start", headers=h), 409, "live_session_busy")

    ok(client.post(f"{API}/timer/discard", headers=h))
    player = ok(client.post(f"{API}/routines/{rid}/start", headers=h))
    assert player["run"]["state"] == "in_progress"
    err(client.post(f"{API}/{a}/timer", headers=h), 409, "live_session_busy")

    # Another user's Live bar is independent.
    _, other = signed_in(db)
    c = make_habit(client, other, name="Mine")["id"]
    ok(client.post(f"{API}/{c}/timer", headers=other))


def test_routine_run_state_machine_end_to_end(client: TestClient, db: Session) -> None:
    _, h = signed_in(db)
    check = make_habit(client, h, name="Make bed")["id"]
    count = make_habit(client, h, name="Push-ups", type="count", target=20, step=10)[
        "id"
    ]
    timed = make_habit(client, h, name="Stretch", type="duration", target=1)["id"]
    archived = make_habit(client, h, name="Old")["id"]
    rid = _routine(
        client,
        h,
        [
            {"habit_id": check, "minutes": 1},
            {"habit_id": archived, "minutes": 1},
            {"habit_id": count, "minutes": 2},
            {"habit_id": timed, "minutes": 1},
        ],
    )["id"]
    ok(client.post(f"{API}/{archived}/archive", headers=h))

    p = ok(client.post(f"{API}/routines/{rid}/start", headers=h))
    run_id = p["run"]["id"]
    # The archived habit's step is left out of the run's frozen plan.
    assert [s["habit_id"] for s in p["run"]["steps"]] == [check, count, timed]
    assert p["current_step"]["name"] == "Make bed"
    assert p["next_step"]["name"] == "Push-ups"
    # Start again resumes the same run.
    assert (
        ok(client.post(f"{API}/routines/{rid}/start", headers=h))["run"]["id"] == run_id
    )

    r1 = ok(client.post(f"{API}/runs/{run_id}/done", headers=h))
    assert r1["current"] == 1
    assert r1["results"][0]["status"] == "done"
    log = ok(client.get(f"{API}/{check}/logs", headers=h))["data"][0]
    assert (log["status"], log["source"]) == ("done", "routine")

    r2 = ok(client.post(f"{API}/runs/{run_id}/skip", headers=h))
    assert [x["status"] for x in r2["results"]] == ["done", "skipped"]
    skipped = ok(client.get(f"{API}/{count}/logs", headers=h))["data"][0]
    assert (skipped["status"], skipped["source"]) == ("skipped", "routine")

    back = ok(client.post(f"{API}/runs/{run_id}/back", headers=h))
    assert back["current"] == 1
    assert [x["status"] for x in back["results"]] == ["done"]
    plus = ok(client.post(f"{API}/runs/{run_id}/add-minute", headers=h))
    assert plus["step_bonus_sec"] == 60
    paused = ok(client.post(f"{API}/runs/{run_id}/toggle-pause", headers=h))
    assert paused["paused_at"] is not None
    resumed = ok(client.post(f"{API}/runs/{run_id}/toggle-pause", headers=h))
    assert resumed["paused_at"] is None

    r3 = ok(client.post(f"{API}/runs/{run_id}/done", headers=h))
    assert r3["current"] == 2
    counted = ok(client.get(f"{API}/{count}/logs", headers=h))["data"][0]
    # Done after a skip: the count step logs ``step`` (10 of 20) as partial.
    assert (counted["status"], counted["value"]) == ("partial", 10)

    r4 = ok(client.post(f"{API}/runs/{run_id}/done", headers=h))
    assert r4["state"] == "completed"
    assert r4["ended_at"] is not None
    assert [x["status"] for x in r4["results"]] == ["done", "done", "done"]
    timed_log = ok(client.get(f"{API}/{timed}/logs", headers=h))["data"][0]
    assert (timed_log["value"], timed_log["source"]) == (1, "routine")

    err(client.post(f"{API}/runs/{run_id}/done", headers=h), 409, "run_not_in_progress")
    # Completing released the Live bar.
    ok(client.post(f"{API}/{timed}/timer", headers=h))
    ok(client.post(f"{API}/timer/discard", headers=h))

    summary = ok(client.get(f"{API}/runs/{run_id}", headers=h))
    assert summary["state"] == "completed"
    assert [s["status"] for s in summary["steps"]] == ["done", "done", "done"]
    assert summary["planned_sec"] == 4 * 60
    rows = db.exec(
        select(RoutineStepResult).where(RoutineStepResult.run_id == uuid.UUID(run_id))
    ).all()
    assert sorted((r.position, r.status, r.deleted_at is None) for r in rows) == [
        (0, "done", True),
        (1, "done", True),
        (2, "done", True),
    ]
    today = ok(client.get(f"{API}/today", headers=h))
    assert today["routines"][0]["state"] == "done"
    detail = ok(client.get(f"{API}/routines/{rid}", headers=h))
    assert detail["archived_steps"] == 1
    assert detail["recent_runs"][0]["id"] == run_id
    assert detail["active_run"] is None
    assert ok(client.get(f"{API}/routines/{rid}/play", headers=h)) is None


def test_exit_keeps_the_run_resumable(client: TestClient, db: Session) -> None:
    _, h = signed_in(db)
    a = make_habit(client, h, name="A")["id"]
    b = make_habit(client, h, name="B")["id"]
    rid = _routine(
        client, h, [{"habit_id": a, "minutes": 1}, {"habit_id": b, "minutes": 1}]
    )["id"]
    run_id = ok(client.post(f"{API}/routines/{rid}/start", headers=h))["run"]["id"]
    ok(client.post(f"{API}/runs/{run_id}/done", headers=h))
    ok(client.post(f"{API}/runs/{run_id}/exit", headers=h))
    # The Live bar is free again, and the run is still there to resume.
    ok(client.post(f"{API}/{a}/timer", headers=h))
    ok(client.post(f"{API}/timer/discard", headers=h))
    play = ok(client.get(f"{API}/routines/{rid}/play", headers=h))
    assert (play["run"]["id"], play["run"]["current"]) == (run_id, 1)
    today = ok(client.get(f"{API}/today", headers=h))
    assert today["routines"][0]["state"] == "resume"
    resumed = ok(client.post(f"{API}/routines/{rid}/start", headers=h))
    assert resumed["run"]["id"] == run_id
    err(client.post(f"{API}/runs/{uuid.uuid4()}/done", headers=h), 404)
    err(client.post(f"{API}/runs/{run_id}/jump", headers=h), 422)
