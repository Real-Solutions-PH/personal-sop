"""Recurring completion: the next occurrence, its derived id, undo, and replay
idempotency through REST and through sync."""

import uuid
from datetime import datetime, timedelta

from fastapi.testclient import TestClient
from sqlmodel import Session

from app.shared.ids import derived_id
from tests.modules.tasks.api.helpers import API, day, new_task, ok, op, pull, push
from tests.utils.mobile import signed_in

DAILY = {"rule": {"kind": "daily"}, "mode": "fixed"}


def _complete(client: TestClient, headers: dict[str, str], task_id: str) -> dict:  # type: ignore[type-arg]
    return ok(client.post(f"{API}/{task_id}/complete", headers=headers))  # type: ignore[no-any-return]


def test_completing_a_daily_task_late_spawns_tomorrow_with_derived_id(
    client: TestClient, db: Session
) -> None:
    _, headers = signed_in(db)
    t = new_task(
        client,
        headers,
        "Water plants",
        due_date=day(-2),
        due_time="19:00",
        remind=True,
        recurrence=DAILY,
        starred=True,
        notes="balcony",
    )
    res = _complete(client, headers, t["id"])
    assert res["task"]["status"] == "done"
    nxt = res["next"]
    # fixed mode: first match after max(due, done day) = tomorrow, no pile-up
    assert nxt["due_date"] == day(1)
    assert nxt["id"] == str(derived_id("task-next", uuid.UUID(t["id"]), day(1)))
    assert nxt["series_parent_id"] == t["id"]
    assert (nxt["title"], nxt["starred"], nxt["notes"], nxt["due_time"]) == (
        "Water plants",
        True,
        "balcony",
        "19:00",
    )
    assert nxt["original_due"] == day(1)
    assert nxt["reschedule_count"] == 0
    # the reminder moves by the same number of days as the due date (+3)
    old = datetime.fromisoformat(t["remind_at"])
    assert datetime.fromisoformat(nxt["remind_at"]) == old + timedelta(days=3)


def test_after_mode_steps_from_the_completion_day(
    client: TestClient, db: Session
) -> None:
    _, headers = signed_in(db)
    t = new_task(
        client,
        headers,
        due_date=day(-5),
        recurrence={"rule": {"kind": "everyN", "n": 3}, "mode": "after"},
    )
    assert _complete(client, headers, t["id"])["next"]["due_date"] == day(3)


def test_rest_replay_of_complete_is_idempotent(client: TestClient, db: Session) -> None:
    _, headers = signed_in(db)
    t = new_task(client, headers, due_date=day(0), recurrence=DAILY)
    first = _complete(client, headers, t["id"])
    again = _complete(client, headers, t["id"])
    assert again["task"]["completed_at"] == first["task"]["completed_at"]
    assert again["next"]["id"] == first["next"]["id"]
    rows = ok(client.get(f"{API}/?status=all", headers=headers))
    assert rows["count"] == 2  # the done one + exactly one next occurrence


def test_uncomplete_removes_an_untouched_next_and_recomplete_revives_it(
    client: TestClient, db: Session
) -> None:
    _, headers = signed_in(db)
    t = new_task(client, headers, due_date=day(0), recurrence=DAILY)
    nxt = _complete(client, headers, t["id"])["next"]
    back = ok(client.post(f"{API}/{t['id']}/uncomplete", headers=headers))
    assert back["status"] == "open" and back["completed_at"] is None
    assert client.get(f"{API}/{nxt['id']}", headers=headers).status_code == 404
    assert ok(client.get(f"{API}/?status=all", headers=headers))["count"] == 1
    # not in Recently deleted: it never happened
    assert ok(client.get(f"{API}/deleted", headers=headers))["count"] == 0

    again = _complete(client, headers, t["id"])["next"]
    assert again["id"] == nxt["id"]
    assert again["status"] == "open"


def test_uncomplete_keeps_a_next_occurrence_that_was_edited(
    client: TestClient, db: Session
) -> None:
    _, headers = signed_in(db)
    t = new_task(client, headers, due_date=day(0), recurrence=DAILY)
    nxt = _complete(client, headers, t["id"])["next"]
    ok(client.patch(f"{API}/{nxt['id']}", headers=headers, json={"notes": "edited"}))
    ok(client.post(f"{API}/{t['id']}/uncomplete", headers=headers))
    assert ok(client.get(f"{API}/{nxt['id']}", headers=headers))["notes"] == "edited"


def test_sync_complete_replay_and_device_optimistic_copy(
    client: TestClient, db: Session
) -> None:
    _, headers = signed_in(db)
    t = new_task(client, headers, due_date=day(-1), recurrence=DAILY)
    tid = uuid.UUID(t["id"])
    next_id = derived_id("task-next", tid, day(1))

    # Offline, the device made the next occurrence itself with the derived id,
    # then pushes it before the completion action.
    created = op("upsert", "task", next_id, title="Task", due_date=day(1))
    action = op("action", "tasks.complete", task_id=str(tid))
    first = push(client, headers, created, action)
    assert [r["status"] for r in first] == ["applied", "applied"]
    assert first[1]["result"]["next"]["id"] == str(next_id)

    # The same op replayed: the stored result, nothing re-applied.
    replay = push(client, headers, action)[0]
    assert replay["replayed"] is True
    assert replay["result"] == first[1]["result"]
    # A retry under a new op id is still a no-op.
    retry = push(client, headers, op("action", "tasks.complete", task_id=str(tid)))[0]
    assert retry["status"] == "applied"
    assert retry["result"]["next"]["id"] == str(next_id)

    tasks = [c for c in pull(client, headers) if c["entity"] == "task"]
    assert {c["id"] for c in tasks} == {str(tid), str(next_id)}


def test_sync_uncomplete_tombstones_the_spawned_occurrence(
    client: TestClient, db: Session
) -> None:
    _, headers = signed_in(db)
    t = new_task(client, headers, due_date=day(0), recurrence=DAILY)
    res = push(client, headers, op("action", "tasks.complete", task_id=t["id"]))[0]
    next_id = res["result"]["next"]["id"]
    cursor = max(c["version"] for c in pull(client, headers))
    push(client, headers, op("action", "tasks.uncomplete", task_id=t["id"]))
    changes = {c["id"]: c for c in pull(client, headers, cursor)}
    assert changes[next_id]["deleted"] is True
    assert changes[t["id"]]["row"]["status"] == "open"


def test_offline_completion_counts_for_the_day_it_happened(
    client: TestClient, db: Session
) -> None:
    _, headers = signed_in(db)
    t = new_task(client, headers, due_date=day(-3), recurrence=DAILY)
    when = (datetime.now().astimezone() - timedelta(days=2)).isoformat()
    res = ok(
        client.post(
            f"{API}/{t['id']}/complete", headers=headers, json={"completed_at": when}
        )
    )
    # done two days ago → next is the day after that
    assert res["next"]["due_date"] == day(-1)
    future = (datetime.now().astimezone() + timedelta(days=2)).isoformat()
    t2 = new_task(client, headers, due_date=day(0))
    done = ok(
        client.post(
            f"{API}/{t2['id']}/complete", headers=headers, json={"completed_at": future}
        )
    )
    assert (
        datetime.fromisoformat(done["task"]["completed_at"])
        <= datetime.now().astimezone()
    )
