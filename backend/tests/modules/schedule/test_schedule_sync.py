"""Schedule overrides through ``/sync/push``, ``/sync/pull`` and the calendar."""

import uuid
from datetime import timedelta
from typing import Any

from fastapi.testclient import TestClient
from sqlmodel import Session

from app.core.config import settings
from tests.utils.mobile import ctx_for, signed_in

API = settings.API_V1_STR
SYNC = f"{API}/sync"


def op(op_kind: str, target: str, row_id: Any = None, **data: Any) -> dict[str, Any]:
    return {
        "op_id": str(uuid.uuid4()),
        "kind": op_kind,
        "name": target,
        "id": str(row_id) if row_id else None,
        "data": data,
    }


def push(client: TestClient, h: dict[str, str], *ops: dict[str, Any]) -> Any:
    r = client.post(f"{SYNC}/push", headers=h, json={"ops": list(ops)})
    assert r.status_code == 200, r.text
    return r.json()["results"]


def _habit(client: TestClient, h: dict[str, str], time: str = "09:00") -> uuid.UUID:
    hid = uuid.uuid4()
    res = push(
        client,
        h,
        op(
            "upsert",
            "habit",
            hid,
            name="Read",
            icon="📖",
            type="check",
            schedule=[{"days": [0, 1, 2, 3, 4, 5, 6], "time": time}],
        ),
    )
    assert res[0]["status"] == "applied", res
    return hid


def _calendar(client: TestClient, h: dict[str, str], day: str) -> list[Any]:
    r = client.get(f"{API}/stats/calendar?from={day}&to={day}", headers=h)
    assert r.status_code == 200, r.text
    return list(r.json()["data"])


def test_moving_a_habit_for_today_moves_only_today_on_the_calendar(
    client: TestClient, db: Session
) -> None:
    user, h = signed_in(db)
    with ctx_for(user) as ctx:
        today = ctx.today
    hid = _habit(client, h)
    res = push(
        client,
        h,
        op(
            "upsert",
            "schedule_override",
            uuid.uuid4(),
            kind="habit",
            ref_id=str(hid),
            day=str(today),
            time="14:30",
        ),
    )
    assert res[0]["status"] == "applied", res
    mine = [i for i in _calendar(client, h, str(today)) if str(hid) in i["id"]]
    assert [i["time"] for i in mine] == ["14:30"]
    tomorrow = str(today + timedelta(days=1))
    later = [i for i in _calendar(client, h, tomorrow) if str(hid) in i["id"]]
    assert [i["time"] for i in later] == ["09:00"]
    # The habit's own schedule is untouched.
    pulled = client.get(f"{SYNC}/pull?cursor=0&limit=500", headers=h).json()
    habit = next(c["row"] for c in pulled["changes"] if c["entity"] == "habit")
    assert habit["schedule"][0]["time"] == "09:00"


def test_a_second_device_lands_on_the_same_row_and_a_reset_restores_the_time(
    client: TestClient, db: Session
) -> None:
    user, h = signed_in(db)
    with ctx_for(user) as ctx:
        today = str(ctx.today)
    hid = _habit(client, h)
    first = push(
        client,
        h,
        op(
            "upsert",
            "schedule_override",
            uuid.uuid4(),
            kind="habit",
            ref_id=str(hid),
            day=today,
            time="10:00",
        ),
    )[0]
    again = push(
        client,
        h,
        op(
            "upsert",
            "schedule_override",
            uuid.uuid4(),
            kind="habit",
            ref_id=str(hid),
            day=today,
            time="11:15",
        ),
    )[0]
    assert again["row"]["id"] == first["row"]["id"]
    assert again["row"]["time"] == "11:15"
    gone = push(client, h, op("delete", "schedule_override", first["row"]["id"]))[0]
    assert gone["status"] == "applied"
    mine = [i for i in _calendar(client, h, today) if str(hid) in i["id"]]
    assert [i["time"] for i in mine] == ["09:00"]
    # Moving it again after a reset revives the same row.
    back = push(
        client,
        h,
        op(
            "upsert",
            "schedule_override",
            uuid.uuid4(),
            kind="habit",
            ref_id=str(hid),
            day=today,
            time="12:00",
        ),
    )[0]
    assert back["status"] == "applied" and back["row"]["id"] == first["row"]["id"]


def test_refuses_a_bad_time_kind_or_someone_elses_habit(
    client: TestClient, db: Session
) -> None:
    user, h = signed_in(db)
    _, other_h = signed_in(db)
    with ctx_for(user) as ctx:
        today = str(ctx.today)
    hid = _habit(client, h)
    theirs = _habit(client, other_h)
    res = push(
        client,
        h,
        op(
            "upsert",
            "schedule_override",
            uuid.uuid4(),
            kind="habit",
            ref_id=str(hid),
            day=today,
            time="25:00",
        ),
        op(
            "upsert",
            "schedule_override",
            uuid.uuid4(),
            kind="workout",
            ref_id=str(hid),
            day=today,
            time="10:00",
        ),
        op(
            "upsert",
            "schedule_override",
            uuid.uuid4(),
            kind="habit",
            ref_id=str(theirs),
            day=today,
            time="10:00",
        ),
        op(
            "upsert",
            "schedule_override",
            uuid.uuid4(),
            kind="habit",
            ref_id=str(uuid.uuid4()),
            day=today,
            time="10:00",
        ),
    )
    assert [r["status"] for r in res] == ["rejected"] * 4, res


def test_a_moved_recurring_occurrence_is_pushed_at_the_moved_time(
    client: TestClient, db: Session
) -> None:
    """The server's task reminder push follows the occurrence's move: not at
    the series time (when it was moved later), but at the moved time."""
    from datetime import UTC, datetime

    from app.modules.tasks import jobs
    from tests.modules.tasks.api.helpers import day, new_task

    user, h = signed_in(db)
    remind = datetime.now(UTC) - timedelta(minutes=1)
    t = new_task(
        client,
        h,
        "Stand-up",
        due_date=day(0),
        due_time="09:00",
        remind_at=remind.isoformat(),
        recurrence={"rule": {"kind": "daily"}, "mode": "fixed"},
    )
    res = push(
        client,
        h,
        op("upsert", "schedule_override", uuid.uuid4(), kind="task",
           ref_id=t["id"], day=day(0), time="11:00"),
    )
    assert res[0]["status"] == "applied", res
    # Its own reminder time has passed, the moved one (two hours on) not yet.
    with ctx_for(user, now=datetime.now(UTC)) as ctx:
        assert jobs.send_reminders(ctx) == 0
    later = datetime.now(UTC) + timedelta(hours=2)
    with ctx_for(user, now=later) as ctx:
        assert jobs.send_reminders(ctx) == 1
