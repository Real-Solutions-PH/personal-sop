"""Habits through the sync engine: every entity pushed and pulled, replays,
tombstones, the (habit, day) natural key and the domain actions."""

import uuid
from typing import Any

from fastapi.testclient import TestClient
from sqlmodel import Session

from app.core.config import settings
from tests.modules.habits.api.util import API, ok, today
from tests.utils.mobile import signed_in

SYNC = f"{settings.API_V1_STR}/sync"


def _op(kind: str, entity: str, row_id: Any = None, /, **data: Any) -> dict[str, Any]:
    return {
        "op_id": str(uuid.uuid4()),
        "kind": kind,
        "name": entity,
        "id": str(row_id) if row_id else None,
        "data": data,
    }


def _push(client: TestClient, h: dict[str, str], *ops: dict[str, Any]) -> list[Any]:
    body = ok(client.post(f"{SYNC}/push", headers=h, json={"ops": list(ops)}))
    return list(body["results"])


def _pull(client: TestClient, h: dict[str, str], cursor: int = 0) -> list[Any]:
    out: list[Any] = []
    while True:
        page = ok(
            client.get(
                f"{SYNC}/pull", headers=h, params={"cursor": cursor, "limit": 500}
            )
        )
        out.extend(page["changes"])
        cursor = page["cursor"]
        if not page["truncated"]:
            return out


def test_entities_push_and_pull(client: TestClient, db: Session) -> None:
    _, h = signed_in(db)
    hid, rid, pid, sid = (uuid.uuid4() for _ in range(4))
    day = today(client, h)
    res = _push(
        client,
        h,
        _op("upsert", "habit", hid, name="Read", type="count", target=20, step=5),
        _op(
            "upsert",
            "habit_log",
            uuid.uuid4(),
            habit_id=str(hid),
            day=day,
            status="partial",
            value=5,
        ),
        _op(
            "upsert", "habit_pause", pid, habit_id=str(hid), from_day=day, reason="Trip"
        ),
        _op("upsert", "routine", rid, name="Evening"),
        _op(
            "upsert",
            "routine_step",
            sid,
            routine_id=str(rid),
            habit_id=str(hid),
            position=0,
            minutes=15,
        ),
        _op("upsert", "habit_settings", uuid.uuid4(), week_start=0),
    )
    assert [r["status"] for r in res] == ["applied"] * 6, res
    assert res[0]["row"]["schedule"] == [{"days": [0, 1, 2, 3, 4, 5, 6]}]

    changes = _pull(client, h)
    kinds = {c["entity"] for c in changes}
    assert {
        "habit",
        "habit_log",
        "habit_pause",
        "routine",
        "routine_step",
        "habit_settings",
    } <= kinds
    versions = [c["version"] for c in changes]
    assert versions == sorted(versions)

    # Field-level LWW: only the pushed field changes.
    renamed = _push(client, h, _op("upsert", "habit", hid, name="Read 20 pages"))[0]
    assert (renamed["row"]["name"], renamed["row"]["target"]) == ("Read 20 pages", 20)
    missing = _push(client, h, _op("upsert", "habit", uuid.uuid4(), icon="x"))[0]
    assert (missing["status"], missing["code"]) == ("rejected", "missing_fields")
    bad = _push(
        client,
        h,
        _op(
            "upsert",
            "habit_pause",
            uuid.uuid4(),
            habit_id=str(hid),
            from_day=day,
            to_day="2000-01-01",
        ),
    )[0]
    assert (bad["status"], bad["code"]) == ("rejected", "pause_range_invalid")
    ro = _push(
        client, h, _op("upsert", "routine_run", uuid.uuid4(), state="completed")
    )[0]
    assert (ro["status"], ro["code"]) == ("rejected", "unknown_entity")
    foreign = _push(
        client,
        h,
        _op(
            "upsert",
            "habit_log",
            uuid.uuid4(),
            habit_id=str(uuid.uuid4()),
            day=day,
            status="done",
        ),
    )[0]
    assert (foreign["status"], foreign["code"]) == ("rejected", "habit_not_found")


def test_log_replay_tombstone_and_natural_key_revival(
    client: TestClient, db: Session
) -> None:
    _, h = signed_in(db)
    hid = uuid.uuid4()
    day = today(client, h)
    _push(client, h, _op("upsert", "habit", hid, name="Walk"))
    first_id = uuid.uuid4()
    op = _op("upsert", "habit_log", first_id, habit_id=str(hid), day=day, status="done")
    first = _push(client, h, op)[0]
    assert first["status"] == "applied"
    again = _push(client, h, op)[0]
    assert again["replayed"] is True
    assert again["row"] == first["row"]

    cursor = max(c["version"] for c in _pull(client, h))
    assert (
        _push(client, h, _op("delete", "habit_log", first_id))[0]["status"] == "applied"
    )
    gone = [c for c in _pull(client, h, cursor) if c["entity"] == "habit_log"]
    assert gone == [
        {
            "entity": "habit_log",
            "id": str(first_id),
            "version": gone[0]["version"],
            "deleted": True,
            "row": None,
        }
    ]

    # Another device logs the same day with its own id: the tombstoned row
    # holding (habit, day) is revived, keeping its id.
    other = _push(
        client,
        h,
        _op(
            "upsert",
            "habit_log",
            uuid.uuid4(),
            habit_id=str(hid),
            day=day,
            status="skipped",
            value=3,
        ),
    )[0]
    assert other["status"] == "applied"
    assert other["row"]["id"] == str(first_id)
    assert (other["row"]["status"], other["row"]["value"]) == ("skipped", None)
    logs = ok(client.get(f"{API}/{hid}/logs", headers=h))
    assert logs["count"] == 1


def test_domain_actions(client: TestClient, db: Session) -> None:
    _, h = signed_in(db)
    hid, tid, rid = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    _push(
        client,
        h,
        _op("upsert", "habit", hid, name="Water", type="count", target=3, step=1),
        _op("upsert", "habit", tid, name="Focus", type="duration", target=25),
        _op("upsert", "routine", rid, name="AM"),
        _op(
            "upsert",
            "routine_step",
            uuid.uuid4(),
            routine_id=str(rid),
            habit_id=str(hid),
            position=0,
            minutes=1,
        ),
    )
    res = _push(
        client,
        h,
        _op("action", "habits.increment", habit_id=str(hid)),
        _op("action", "habits.increment", habit_id=str(hid), by=2),
        _op("action", "habits.skip", habit_id=str(tid), note="Busy"),
        _op("action", "habits.check", habit_id=str(tid)),
    )
    assert [r["status"] for r in res] == ["applied"] * 4, res
    assert (res[0]["result"]["log"]["value"], res[0]["result"]["log"]["status"]) == (
        1,
        "partial",
    )
    assert (res[1]["result"]["log"]["value"], res[1]["result"]["log"]["status"]) == (
        3,
        "done",
    )
    assert res[3]["result"]["log"]["value"] == 25

    timer = _push(
        client,
        h,
        _op("action", "habits.timer.start", habit_id=str(tid)),
        _op("action", "habits.timer.pause"),
        _op("action", "habits.timer.resume"),
        _op("action", "habits.timer.extend", sec=60),
        _op("action", "habits.run.start", routine_id=str(rid)),
        _op("action", "habits.timer.finish", minutes=30),
    )
    assert [r["status"] for r in timer] == [
        "applied",
        "applied",
        "applied",
        "applied",
        "rejected",
        "applied",
    ]
    assert timer[4]["code"] == "live_session_busy"
    assert timer[5]["result"]["log"]["source"] == "timer"
    pulled = {c["entity"] for c in _pull(client, h)}
    assert "habit_timer" in pulled

    run_id = uuid.uuid4()
    start = _push(
        client,
        h,
        _op("action", "habits.run.start", routine_id=str(rid), run_id=str(run_id)),
    )[0]
    assert start["result"]["run"]["id"] == str(run_id)
    done = _push(client, h, _op("action", "habits.run.done", run_id=str(run_id)))[0]
    assert done["result"]["run"]["state"] == "completed"
    again = _push(client, h, _op("action", "habits.run.done", run_id=str(run_id)))[0]
    assert (again["status"], again["code"]) == ("rejected", "run_not_in_progress")
    replayed_start = _push(
        client,
        h,
        _op("action", "habits.run.start", routine_id=str(rid), run_id=str(run_id)),
    )[0]
    assert replayed_start["result"]["run"]["state"] == "completed"
    entities = {c["entity"] for c in _pull(client, h)}
    assert {"routine_run", "routine_step_result"} <= entities

    unknown = _push(client, h, _op("action", "habits.teleport"))[0]
    assert unknown["code"] == "unknown_action"
    bad = _push(client, h, _op("action", "habits.timer.extend", sec=0))[0]
    assert bad["code"] == "validation_error"


def test_habit_delete_via_sync_drops_logs(client: TestClient, db: Session) -> None:
    _, h = signed_in(db)
    hid = uuid.uuid4()
    _push(client, h, _op("upsert", "habit", hid, name="Floss"))
    log = _push(client, h, _op("action", "habits.check", habit_id=str(hid)))[0]
    log_id = log["result"]["log"]["id"]
    assert _push(client, h, _op("delete", "habit", hid))[0]["status"] == "applied"
    tomb = {c["id"]: c["deleted"] for c in _pull(client, h)}
    assert tomb[str(hid)] is True
    assert tomb[log_id] is True
    _, other = signed_in(db)
    assert not [c for c in _pull(client, other) if c["entity"].startswith("habit")]


def test_a_run_can_be_reset_and_started_over(client: TestClient, db: Session) -> None:
    """Start over: today's run ends unfinished, the next start is a new run at
    step one, and a habit its first step logged stays logged."""
    _, h = signed_in(db)
    bed, journal, rid = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    _push(
        client,
        h,
        _op("upsert", "habit", bed, name="Fix the bed", type="check"),
        _op("upsert", "habit", journal, name="Journal", type="check"),
        _op("upsert", "routine", rid, name="Morning"),
        *[
            _op(
                "upsert",
                "routine_step",
                uuid.uuid4(),
                routine_id=str(rid),
                habit_id=str(hid),
                position=i,
                minutes=5,
            )
            for i, hid in enumerate([bed, journal])
        ],
    )
    first = uuid.uuid4()
    _push(
        client,
        h,
        _op("action", "habits.run.start", routine_id=str(rid), run_id=str(first)),
        _op("action", "habits.run.done", run_id=str(first)),
    )
    reset = _push(client, h, _op("action", "habits.run.abandon", run_id=str(first)))
    assert reset[0]["status"] == "applied", reset
    assert reset[0]["result"]["run"]["state"] == "abandoned"
    # Ended: a second reset, or a step on it, is refused.
    again = _push(client, h, _op("action", "habits.run.abandon", run_id=str(first)))
    assert again[0]["code"] == "run_not_in_progress"

    second = uuid.uuid4()
    start = _push(
        client,
        h,
        _op("action", "habits.run.start", routine_id=str(rid), run_id=str(second)),
    )[0]
    assert start["status"] == "applied", start
    assert (start["result"]["run"]["id"], start["result"]["run"]["current"]) == (
        str(second),
        0,
    )
    logs = [
        c["row"]
        for c in _pull(client, h)
        if c["entity"] == "habit_log" and c["row"]["habit_id"] == str(bed)
    ]
    assert [x["status"] for x in logs] == ["done"]
