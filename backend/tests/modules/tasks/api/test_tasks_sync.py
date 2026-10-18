"""Sync: push and pull of every tasks entity, replays, tombstones, actions."""

import uuid

from fastapi.testclient import TestClient
from sqlmodel import Session

from tests.modules.tasks.api.helpers import (
    API,
    day,
    new_list,
    new_task,
    ok,
    op,
    pull,
    push,
)
from tests.utils.mobile import signed_in


def _rows(
    client: TestClient, headers: dict[str, str], entity: str, cursor: int = 0
) -> dict[str, dict]:  # type: ignore[type-arg]
    return {c["id"]: c for c in pull(client, headers, cursor) if c["entity"] == entity}


def test_task_list_push_pull_replay_and_tombstone(
    client: TestClient, db: Session
) -> None:
    _, headers = signed_in(db)
    lid = uuid.uuid4()
    create = op(
        "upsert", "task_list", lid, name="Errands", kind="shopping", icon="cart"
    )
    first = push(client, headers, create)[0]
    assert first["status"] == "applied"
    assert (first["row"]["name"], first["row"]["kind"]) == ("Errands", "shopping")
    assert push(client, headers, create)[0]["replayed"] is True

    renamed = push(client, headers, op("upsert", "task_list", lid, sort_order=4))[0]
    assert (renamed["row"]["name"], renamed["row"]["sort_order"]) == ("Errands", 4)
    missing = push(
        client, headers, op("upsert", "task_list", uuid.uuid4(), color="fin")
    )[0]
    assert (missing["status"], missing["code"]) == ("rejected", "missing_fields")

    t = new_task(client, headers, "milk", list_id=str(lid))
    assert (
        push(client, headers, op("delete", "task_list", lid))[0]["status"] == "applied"
    )
    lists = _rows(client, headers, "task_list")
    assert lists[str(lid)]["deleted"] is True and lists[str(lid)]["row"] is None
    # the generic delete still moves its tasks to the Inbox
    assert ok(client.get(f"{API}/{t['id']}", headers=headers))["list_id"] is None


def test_task_push_pull_due_change_counts_and_status_is_not_a_field(
    client: TestClient, db: Session
) -> None:
    _, headers = signed_in(db)
    tid = uuid.uuid4()
    res = push(
        client, headers, op("upsert", "task", tid, title="Pay rent", due_date=day(0))
    )[0]
    assert res["status"] == "applied"
    assert (res["row"]["original_due"], res["row"]["sort_order"]) == (day(0), 0)

    later = push(
        client, headers, op("upsert", "task", tid, due_date=day(2), status="done")
    )[0]
    assert (later["row"]["due_date"], later["row"]["reschedule_count"]) == (day(2), 1)
    assert later["row"]["status"] == "open"  # status only changes through actions
    assert later["row"]["original_due"] == day(0)

    bad = push(client, headers, op("upsert", "task", tid, due_time="7pm"))[0]
    assert (bad["status"], bad["code"]) == ("rejected", "validation_error")
    assert "7pm" not in (bad["message"] or "")
    missing = push(client, headers, op("upsert", "task", uuid.uuid4(), notes="x"))[0]
    assert missing["code"] == "missing_fields"
    foreign_list = push(
        client,
        headers,
        op("upsert", "task", uuid.uuid4(), title="x", list_id=str(uuid.uuid4())),
    )[0]
    assert (foreign_list["status"], foreign_list["code"]) == (
        "rejected",
        "task_list_not_found",
    )

    assert _rows(client, headers, "task")[str(tid)]["row"]["due_date"] == day(2)


def test_task_delete_tombstones_and_restore_action_revives(
    client: TestClient, db: Session
) -> None:
    _, headers = signed_in(db)
    t = new_task(client, headers, "x", due_date=day(1))
    assert (
        push(client, headers, op("delete", "task", t["id"]))[0]["status"] == "applied"
    )
    assert (
        push(client, headers, op("delete", "task", t["id"]))[0]["status"] == "applied"
    )
    assert _rows(client, headers, "task")[t["id"]]["deleted"] is True
    stale = push(
        client, headers, op("upsert", "task", t["id"], title="edited offline")
    )[0]
    assert (stale["status"], stale["code"]) == ("conflict", "deleted_on_server")
    back = push(client, headers, op("action", "tasks.restore", task_id=t["id"]))[0]
    assert back["result"]["task"]["status"] == "open"
    assert _rows(client, headers, "task")[t["id"]]["row"]["status"] == "open"


def test_settings_and_notif_are_one_row_whatever_id_the_device_mints(
    client: TestClient, db: Session
) -> None:
    _, headers = signed_in(db)
    a = push(
        client, headers, op("upsert", "task_settings", uuid.uuid4(), digest_on=True)
    )[0]
    b = push(
        client, headers, op("upsert", "task_settings", uuid.uuid4(), quiet_end="06:30")
    )[0]
    assert a["row"]["id"] == b["row"]["id"]
    assert (b["row"]["digest_on"], b["row"]["quiet_end"]) == (True, "06:30")
    assert ok(client.get(f"{API}/settings", headers=headers))["quiet_end"] == "06:30"
    reset = push(client, headers, op("delete", "task_settings", b["row"]["id"]))[0]
    assert reset["status"] == "applied"
    assert ok(client.get(f"{API}/settings", headers=headers))["digest_on"] is False

    n = push(
        client,
        headers,
        op("upsert", "task_notif_state", uuid.uuid4(), permission="denied"),
    )[0]
    assert n["row"]["permission"] == "denied"
    assert set(_rows(client, headers, "task_notif_state")) == {n["row"]["id"]}
    assert set(_rows(client, headers, "task_settings")) == {a["row"]["id"]}


def test_every_domain_action(client: TestClient, db: Session) -> None:
    _, headers = signed_in(db)
    shop = new_list(client, headers, "Groceries", kind="shopping")
    doomed = new_list(client, headers, "Doomed")
    a = new_task(client, headers, "a", due_date=day(-2))
    b = new_task(client, headers, "b", due_date=day(-1))
    eggs = new_task(client, headers, "eggs", list_id=shop["id"])
    c = new_task(client, headers, "c", list_id=doomed["id"])

    results = push(
        client,
        headers,
        op("action", "tasks.reschedule_by", task_id=a["id"], days=1),
        op("action", "tasks.move_overdue_to_today"),
        op("action", "tasks.snooze", task_id=a["id"], minutes=30),
        op("action", "tasks.complete", task_id=eggs["id"]),
        op("action", "tasks.clear_checked", list_id=shop["id"]),
        op("action", "tasks.unclear", task_ids=[eggs["id"]]),
        op("action", "tasks.uncomplete", task_id=eggs["id"]),
        op("action", "tasks.delete_list", list_id=doomed["id"], mode="delete"),
        op("action", "tasks.remove", task_ids=[b["id"]]),
        op("action", "tasks.nope"),
        op("action", "tasks.snooze", task_id=str(uuid.uuid4())),
    )
    assert [r["status"] for r in results] == ["applied"] * 9 + ["rejected", "rejected"]
    assert results[0]["result"]["task"]["due_date"] == day(1)
    assert results[1]["result"] == {"count": 1}  # only b was still overdue
    assert results[2]["result"]["task"]["remind_at"] is not None
    assert results[4]["result"]["ids"] == [eggs["id"]]
    assert results[5]["result"]["ids"] == [eggs["id"]]
    assert results[6]["result"]["task"]["status"] == "open"
    assert results[7]["result"] == {"count": 1}
    assert (results[9]["code"], results[10]["code"]) == (
        "unknown_action",
        "task_not_found",
    )

    tasks = _rows(client, headers, "task")
    assert tasks[a["id"]]["row"]["reschedule_count"] == 1
    assert tasks[b["id"]]["deleted"] is True  # removed
    assert tasks[c["id"]]["deleted"] is True  # deleted with its list
    assert ok(client.get(f"{API}/deleted", headers=headers))["data"][0]["id"] == c["id"]
    bad_mode = push(
        client, headers, op("action", "tasks.delete_list", list_id=shop["id"], mode="x")
    )[0]
    assert (bad_mode["status"], bad_mode["code"]) == ("rejected", "validation_error")


def test_a_second_user_cannot_touch_the_first_users_rows_through_sync(
    client: TestClient, db: Session
) -> None:
    _, a = signed_in(db)
    _, b = signed_in(db)
    t = new_task(client, a, "mine")
    lst = new_list(client, a, "mine")
    res = push(
        client,
        b,
        op("action", "tasks.complete", task_id=t["id"]),
        op("upsert", "task", t["id"], title="stolen"),
        op("delete", "task_list", lst["id"]),
    )
    assert res[0]["code"] == "task_not_found"
    assert (res[1]["status"], res[1]["code"]) == ("rejected", "id_conflict")
    assert res[2]["status"] == "applied"  # unknown to b: an idempotent no-op
    assert _rows(client, b, "task") == {}
    assert ok(client.get(f"{API}/{t['id']}", headers=a))["title"] == "mine"
    assert ok(client.get(f"{API}/lists/{lst['id']}", headers=a))["name"] == "mine"
