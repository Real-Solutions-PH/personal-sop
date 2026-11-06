"""Task priority (none / low / medium / high): create, edit, sync, the
by-due order, Today's buckets and a recurring task's next occurrence."""

import uuid

from fastapi.testclient import TestClient
from sqlmodel import Session

from tests.modules.tasks.api.helpers import API, day, new_task, ok, op, pull, push
from tests.utils.mobile import signed_in


def test_a_new_task_has_no_priority_until_one_is_given(
    client: TestClient, db: Session
) -> None:
    _, headers = signed_in(db)
    assert new_task(client, headers, "Plain")["priority"] == "none"
    assert new_task(client, headers, "Big", priority="high")["priority"] == "high"
    r = client.post(
        f"{API}/", headers=headers, json={"title": "x", "priority": "urgent"}
    )
    assert r.status_code == 422


def test_patch_changes_it_and_refuses_null_or_unknown(
    client: TestClient, db: Session
) -> None:
    _, headers = signed_in(db)
    t = new_task(client, headers, "Pay rent")
    url = f"{API}/{t['id']}"
    assert (
        ok(client.patch(url, headers=headers, json={"priority": "medium"}))["priority"]
        == "medium"
    )
    assert ok(client.get(url, headers=headers))["priority"] == "medium"
    assert (
        client.patch(url, headers=headers, json={"priority": "p1"}).status_code == 422
    )
    assert (
        client.patch(url, headers=headers, json={"priority": None}).status_code == 422
    )
    assert ok(client.get(url, headers=headers))["priority"] == "medium"


def test_sync_create_edit_and_pull_carry_it(client: TestClient, db: Session) -> None:
    _, headers = signed_in(db)
    tid = uuid.uuid4()
    res = push(client, headers, op("upsert", "task", tid, title="Ship", priority="low"))
    assert res[0]["status"] == "applied", res
    rows = {c["id"]: c["row"] for c in pull(client, headers)}
    assert rows[str(tid)]["priority"] == "low"
    push(client, headers, op("upsert", "task", tid, priority="high"))
    rows = {c["id"]: c["row"] for c in pull(client, headers)}
    assert rows[str(tid)]["priority"] == "high"


def test_by_due_puts_higher_priority_first_within_a_day(
    client: TestClient, db: Session
) -> None:
    _, headers = signed_in(db)
    # Created low-to-high so creation order (sort_order) would give the
    # opposite answer; starred must not outrank priority, and the date
    # still outranks both.
    new_task(client, headers, "none starred", due_date=day(1), starred=True)
    new_task(client, headers, "low", due_date=day(1), priority="low")
    new_task(client, headers, "medium", due_date=day(1), priority="medium")
    new_task(client, headers, "high", due_date=day(1), priority="high")
    new_task(client, headers, "earlier none", due_date=day(0))
    got = [
        t["title"] for t in ok(client.get(f"{API}/?sort=due", headers=headers))["data"]
    ]
    assert got == ["earlier none", "high", "medium", "low", "none starred"]


def test_today_orders_due_tasks_by_priority(client: TestClient, db: Session) -> None:
    _, headers = signed_in(db)
    new_task(client, headers, "low", due_date=day(0), priority="low")
    new_task(client, headers, "plain", due_date=day(0))
    new_task(client, headers, "high", due_date=day(0), priority="high")
    today = ok(client.get(f"{API}/today", headers=headers))
    assert [t["title"] for t in today["due"]] == ["high", "low", "plain"]


def test_next_occurrence_keeps_the_priority(client: TestClient, db: Session) -> None:
    _, headers = signed_in(db)
    t = new_task(
        client,
        headers,
        "Standup",
        due_date=day(0),
        priority="high",
        recurrence={"rule": {"kind": "daily"}, "mode": "fixed"},
    )
    res = ok(client.post(f"{API}/{t['id']}/complete", headers=headers))
    assert res["next"]["priority"] == "high"
