"""REST: CRUD, every screen action, errors, isolation and pagination."""

import uuid
from datetime import datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, col, select

from app.modules.tasks.models import TaskEvent
from tests.modules.tasks.api.helpers import API, day, new_list, new_task, ok, today
from tests.utils.mobile import signed_in
from tests.utils.user import create_auth_user
from tests.utils.utils import auth_headers


def _events(db: Session, task_id: str) -> list[str]:
    db.expire_all()
    rows = db.exec(
        select(TaskEvent)
        .where(col(TaskEvent.task_id) == uuid.UUID(task_id))
        .order_by(col(TaskEvent.at), col(TaskEvent.created_at))
    ).all()
    return [e.type for e in rows]


# ---------------------------------------------------------------- CRUD


def test_create_get_update_delete_restore(client: TestClient, db: Session) -> None:
    _, headers = signed_in(db)
    lst = new_list(client, headers, "Work")
    tid = str(uuid.uuid4())
    t = new_task(
        client, headers, "  Reply to Anna  ", id=tid, list_id=lst["id"], due_date=day(0)
    )
    assert (t["id"], t["title"], t["original_due"], t["status"]) == (
        tid,
        "Reply to Anna",
        day(0),
        "open",
    )
    # replaying the create returns the same row
    assert new_task(client, headers, "other", id=tid)["title"] == "Reply to Anna"

    detail = ok(client.get(f"{API}/{tid}", headers=headers))
    assert detail["list_name"] == "Work"
    upd = ok(
        client.patch(
            f"{API}/{tid}", headers=headers, json={"starred": True, "notes": "n"}
        )
    )
    assert (upd["starred"], upd["notes"]) == (True, "n")
    ok(client.patch(f"{API}/{tid}", headers=headers, json={"list_id": None}))
    assert ok(client.get(f"{API}/{tid}", headers=headers))["list_name"] == "Inbox"

    gone = ok(client.delete(f"{API}/{tid}", headers=headers))
    assert gone["status"] == "deleted"
    assert client.get(f"{API}/{tid}", headers=headers).status_code == 404
    deleted = ok(client.get(f"{API}/deleted", headers=headers))
    assert [d["id"] for d in deleted["data"]] == [tid]
    back = ok(client.post(f"{API}/{tid}/restore", headers=headers))
    assert back["status"] == "open"
    assert _events(db, tid) == ["created", "deleted", "restored"]


def test_untitled_and_reminder_defaults(client: TestClient, db: Session) -> None:
    _, headers = signed_in(db)
    t = new_task(client, headers, "   ", due_date=day(1), remind=True)
    assert t["title"] == "Untitled"
    # date-only + remind → the default reminder time (09:00 Manila = 01:00Z)
    assert datetime.fromisoformat(t["remind_at"]).astimezone().utcoffset() is not None
    assert t["remind_at"].startswith(f"{day(1)}T01:00:00")


def test_validation_errors_are_422_without_echo(
    client: TestClient, db: Session
) -> None:
    _, headers = signed_in(db)
    r = client.post(
        f"{API}/", headers=headers, json={"title": "x", "due_time": "25:99"}
    )
    assert r.status_code == 422
    assert "25:99" not in r.text
    bad_rule = {"rule": {"kind": "weekly", "days": []}, "mode": "fixed"}
    r = client.post(
        f"{API}/", headers=headers, json={"title": "x", "recurrence": bad_rule}
    )
    assert r.status_code == 422
    r = client.post(
        f"{API}/",
        headers=headers,
        json={"title": "x", "remind_at": "2026-10-18T10:00:00"},
    )
    assert r.status_code == 422  # naive timestamp
    t = new_task(client, headers)
    r = client.patch(f"{API}/{t['id']}", headers=headers, json={"title": None})
    assert r.status_code == 422


def test_unknown_ids_are_404(client: TestClient, db: Session) -> None:
    _, headers = signed_in(db)
    nope = uuid.uuid4()
    assert client.get(f"{API}/{nope}", headers=headers).status_code == 404
    assert client.post(f"{API}/{nope}/complete", headers=headers).status_code == 404
    assert (
        client.post(
            f"{API}/", headers=headers, json={"title": "x", "list_id": str(nope)}
        ).status_code
        == 404
    )
    assert client.get(f"{API}/lists/{nope}", headers=headers).status_code == 404
    assert (
        client.post(f"{API}/lists/{nope}/clear-checked", headers=headers).status_code
        == 404
    )


def test_without_permission_is_403(client: TestClient, db: Session) -> None:
    user, password = create_auth_user(db, assign_default_role=False)
    headers = auth_headers(user.email, password)
    assert client.get(f"{API}/today", headers=headers).status_code == 403
    assert (
        client.post(f"{API}/", headers=headers, json={"title": "x"}).status_code == 403
    )


def test_a_second_user_cannot_read_or_change_the_first_users_rows(
    client: TestClient, db: Session
) -> None:
    _, a = signed_in(db)
    _, b = signed_in(db)
    lst = new_list(client, a, "Mine")
    t = new_task(client, a, "secret", list_id=lst["id"])
    for method, path in [
        ("GET", f"{API}/{t['id']}"),
        ("PATCH", f"{API}/{t['id']}"),
        ("DELETE", f"{API}/{t['id']}"),
        ("POST", f"{API}/{t['id']}/complete"),
        ("POST", f"{API}/{t['id']}/snooze"),
        ("POST", f"{API}/{t['id']}/restore"),
        ("GET", f"{API}/lists/{lst['id']}"),
        ("DELETE", f"{API}/lists/{lst['id']}"),
    ]:
        body = {"minutes": 5} if path.endswith("snooze") else {}
        r = client.request(method, path, headers=b, json=body)
        assert r.status_code == 404, (method, path, r.text)
    # b cannot file a task into a's list, or reuse a's id
    assert (
        client.post(
            f"{API}/", headers=b, json={"title": "x", "list_id": lst["id"]}
        ).status_code
        == 404
    )
    assert (
        client.post(
            f"{API}/", headers=b, json={"title": "x", "id": t["id"]}
        ).status_code
        == 409
    )
    assert ok(client.get(f"{API}/?status=all", headers=b))["count"] == 0
    assert ok(client.get(f"{API}/search?q=secret&status=all", headers=b))["count"] == 0
    assert ok(client.get(f"{API}/lists", headers=b))["count"] == 0
    # unclear silently ignores ids that are not yours
    assert (
        ok(client.post(f"{API}/unclear", headers=b, json={"ids": [t["id"]]}))["ids"]
        == []
    )
    assert ok(client.get(f"{API}/{t['id']}", headers=a))["title"] == "secret"


def test_pagination_bounds(client: TestClient, db: Session) -> None:
    _, headers = signed_in(db)
    ok(
        client.post(
            f"{API}/batch",
            headers=headers,
            json={"tasks": [{"title": f"t{i}"} for i in range(5)]},
        )
    )
    page = ok(client.get(f"{API}/?skip=1&limit=2&sort=manual", headers=headers))
    assert page["count"] == 5
    assert [t["title"] for t in page["data"]] == ["t1", "t2"]
    assert ok(client.get(f"{API}/?limit=0", headers=headers)) == {
        "data": [],
        "count": 5,
    }
    assert client.get(f"{API}/?limit=101", headers=headers).status_code == 422
    assert client.get(f"{API}/?skip=-1", headers=headers).status_code == 422
    assert (
        client.post(f"{API}/batch", headers=headers, json={"tasks": []}).status_code
        == 422
    )


# ---------------------------------------------------------------- schedule


def test_set_due_later_is_a_reschedule_and_earlier_is_not(
    client: TestClient, db: Session
) -> None:
    _, headers = signed_in(db)
    t = new_task(client, headers, due_date=day(0), due_time="10:00")
    later = ok(
        client.put(f"{API}/{t['id']}/due", headers=headers, json={"due_date": day(2)})
    )
    assert (later["due_date"], later["due_time"], later["reschedule_count"]) == (
        day(2),
        "10:00",
        1,
    )
    assert later["original_due"] == day(0)
    earlier = ok(
        client.put(
            f"{API}/{t['id']}/due",
            headers=headers,
            json={"due_date": day(1), "due_time": None},
        )
    )
    assert (earlier["reschedule_count"], earlier["due_time"]) == (1, None)
    by = ok(
        client.post(f"{API}/{t['id']}/reschedule", headers=headers, json={"days": 3})
    )
    assert (by["due_date"], by["reschedule_count"], by["original_due"]) == (
        day(3),
        2,
        day(0),
    )
    assert _events(db, t["id"]).count("rescheduled") == 2
    # setting a first date on an undated task is not a reschedule
    u = new_task(client, headers)
    first = ok(
        client.put(f"{API}/{u['id']}/due", headers=headers, json={"due_date": day(4)})
    )
    assert (first["reschedule_count"], first["original_due"]) == (0, day(4))


def test_move_all_overdue_to_today(client: TestClient, db: Session) -> None:
    _, headers = signed_in(db)
    a = new_task(client, headers, "a", due_date=day(-3))
    b = new_task(client, headers, "b", due_date=day(-1))
    new_task(client, headers, "c", due_date=day(0))
    triage = ok(client.get(f"{API}/overdue", headers=headers))
    assert [(t["title"], t["days_late"]) for t in triage["data"]] == [
        ("a", 3),
        ("b", 1),
    ]
    assert ok(client.post(f"{API}/overdue/move-to-today", headers=headers)) == {
        "count": 2
    }
    for t in (a, b):
        row = ok(client.get(f"{API}/{t['id']}", headers=headers))
        assert (row["due_date"], row["reschedule_count"]) == (day(0), 1)
    assert ok(client.get(f"{API}/overdue", headers=headers))["count"] == 0


def test_snooze_moves_the_reminder_not_the_due(client: TestClient, db: Session) -> None:
    _, headers = signed_in(db)
    soon = (datetime.now().astimezone() + timedelta(hours=2)).replace(microsecond=0)
    t = new_task(client, headers, due_date=day(0), remind_at=soon.isoformat())
    s = ok(
        client.post(f"{API}/{t['id']}/snooze", headers=headers, json={"minutes": 60})
    )
    assert datetime.fromisoformat(s["remind_at"]) == soon + timedelta(hours=1)
    assert (s["due_date"], s["reschedule_count"]) == (day(0), 0)
    # no reminder yet: snooze from now
    u = new_task(client, headers)
    s2 = ok(client.post(f"{API}/{u['id']}/snooze", headers=headers, json={}))
    delta = datetime.fromisoformat(s2["remind_at"]) - datetime.now().astimezone()
    assert timedelta(minutes=58) < delta <= timedelta(minutes=60)
    assert _events(db, t["id"]) == ["created", "snoozed"]


def test_toggle_and_uncomplete_log_events(client: TestClient, db: Session) -> None:
    _, headers = signed_in(db)
    t = new_task(client, headers, due_date=day(0))
    assert (
        ok(client.post(f"{API}/{t['id']}/toggle", headers=headers))["task"]["status"]
        == "done"
    )
    assert (
        ok(client.post(f"{API}/{t['id']}/toggle", headers=headers))["task"]["status"]
        == "open"
    )
    assert _events(db, t["id"]) == ["created", "completed", "uncompleted"]


def test_duplicate_keeps_a_future_date_and_drops_a_past_one(
    client: TestClient, db: Session
) -> None:
    _, headers = signed_in(db)
    fut = new_task(client, headers, "fut", due_date=day(2), starred=True)
    past = new_task(client, headers, "past", due_date=day(-2))
    d1 = ok(client.post(f"{API}/{fut['id']}/duplicate", headers=headers))
    d2 = ok(client.post(f"{API}/{past['id']}/duplicate", headers=headers))
    assert (d1["due_date"], d1["starred"], d1["title"]) == (day(2), True, "fut")
    assert d2["due_date"] is None
    assert d1["id"] != fut["id"]


def test_move_swaps_neighbours_in_the_visible_order(
    client: TestClient, db: Session
) -> None:
    _, headers = signed_in(db)
    ids = [new_task(client, headers, f"t{i}")["id"] for i in range(3)]
    ok(
        client.post(
            f"{API}/{ids[2]}/move", headers=headers, json={"dir": -1, "ids": ids}
        )
    )
    order = ok(client.get(f"{API}/?sort=manual", headers=headers))["data"]
    assert [t["title"] for t in order] == ["t0", "t2", "t1"]
    # moving past the edge is a no-op
    ok(
        client.post(
            f"{API}/{ids[0]}/move", headers=headers, json={"dir": -1, "ids": ids}
        )
    )
    bad = client.post(
        f"{API}/{ids[0]}/move",
        headers=headers,
        json={"dir": 1, "ids": [ids[1], ids[1]]},
    )
    assert bad.status_code == 422


# ---------------------------------------------------------------- lists


def test_shopping_clear_checked_and_unclear(client: TestClient, db: Session) -> None:
    _, headers = signed_in(db)
    shop = new_list(client, headers, "Groceries", kind="shopping", icon="cart")
    a = new_task(client, headers, "Eggs", list_id=shop["id"])
    b = new_task(client, headers, "Rice", list_id=shop["id"])
    ok(client.post(f"{API}/{a['id']}/complete", headers=headers))
    cleared = ok(
        client.post(f"{API}/lists/{shop['id']}/clear-checked", headers=headers)
    )
    assert cleared["ids"] == [a["id"]]
    assert ok(client.get(f"{API}/{a['id']}", headers=headers))["cleared_at"] is not None
    assert ok(client.get(f"{API}/{b['id']}", headers=headers))["cleared_at"] is None
    assert (
        ok(client.post(f"{API}/lists/{shop['id']}/clear-checked", headers=headers))[
            "ids"
        ]
        == []
    )
    assert ok(
        client.post(f"{API}/unclear", headers=headers, json={"ids": cleared["ids"]})
    )["ids"] == [a["id"]]
    assert ok(client.get(f"{API}/{a['id']}", headers=headers))["cleared_at"] is None


def test_lists_create_update_archive_move_counts(
    client: TestClient, db: Session
) -> None:
    _, headers = signed_in(db)
    a = new_list(client, headers, "A")
    b = new_list(client, headers, "B", color="fin", icon="laptop")
    assert (a["sort_order"], b["sort_order"]) == (0, 1)
    new_task(client, headers, list_id=b["id"])
    rows = ok(client.get(f"{API}/lists", headers=headers))["data"]
    assert [(x["name"], x["open_count"]) for x in rows] == [("A", 0), ("B", 1)]
    ok(client.patch(f"{API}/lists/{a['id']}", headers=headers, json={"name": "Alpha"}))
    moved = ok(
        client.post(f"{API}/lists/{b['id']}/move", headers=headers, json={"dir": -1})
    )
    assert [x["name"] for x in moved["data"]] == ["B", "Alpha"]
    ok(
        client.post(
            f"{API}/lists/{a['id']}/archive", headers=headers, json={"archived": True}
        )
    )
    assert [
        x["name"] for x in ok(client.get(f"{API}/lists", headers=headers))["data"]
    ] == ["B"]
    every = ok(client.get(f"{API}/lists?include_archived=true", headers=headers))
    assert every["count"] == 2
    assert (
        client.post(
            f"{API}/lists", headers=headers, json={"name": "x", "color": "pink"}
        ).status_code
        == 422
    )


@pytest.mark.parametrize("mode", ["inbox", "delete"])
def test_delete_list_modes(client: TestClient, db: Session, mode: str) -> None:
    _, headers = signed_in(db)
    lst = new_list(client, headers, "Doomed")
    open_t = new_task(client, headers, "open", list_id=lst["id"])
    done_t = new_task(client, headers, "done", list_id=lst["id"])
    ok(client.post(f"{API}/{done_t['id']}/complete", headers=headers))
    assert ok(
        client.delete(f"{API}/lists/{lst['id']}?mode={mode}", headers=headers)
    ) == {"count": 2}
    assert client.get(f"{API}/lists/{lst['id']}", headers=headers).status_code == 404
    done_row = ok(client.get(f"{API}/{done_t['id']}", headers=headers))
    assert (done_row["status"], done_row["list_id"]) == ("done", None)
    if mode == "inbox":
        row = ok(client.get(f"{API}/{open_t['id']}", headers=headers))
        assert (row["status"], row["list_id"]) == ("open", None)
    else:
        assert client.get(f"{API}/{open_t['id']}", headers=headers).status_code == 404
        deleted = ok(client.get(f"{API}/deleted", headers=headers))["data"]
        assert [d["id"] for d in deleted] == [open_t["id"]]
    assert (
        client.delete(
            f"{API}/lists/{uuid.uuid4()}?mode=bogus", headers=headers
        ).status_code
        == 422
    )


def test_default_lists_seed_once(client: TestClient, db: Session) -> None:
    _, headers = signed_in(db)
    seeded = ok(client.post(f"{API}/lists/defaults", headers=headers))
    assert [(x["name"], x["kind"]) for x in seeded["data"]] == [
        ("Work", "standard"),
        ("Life", "standard"),
        ("Groceries", "shopping"),
    ]
    groceries = seeded["data"][2]["id"]
    ok(client.delete(f"{API}/lists/{groceries}", headers=headers))
    again = ok(client.post(f"{API}/lists/defaults", headers=headers))
    assert [x["name"] for x in again["data"]] == ["Work", "Life"]


# ---------------------------------------------------------------- capture


def test_capture_splits_routes_and_remove_undoes(
    client: TestClient, db: Session
) -> None:
    _, headers = signed_in(db)
    ok(client.post(f"{API}/lists/defaults", headers=headers))
    lists = {
        x["name"]: x["id"]
        for x in ok(client.get(f"{API}/lists", headers=headers))["data"]
    }
    res = ok(
        client.post(
            f"{API}/capture",
            headers=headers,
            json={
                "text": "buy eggs and rice, call Mark tomorrow 3pm, email client after lunch",
                "source": "capture-voice",
            },
        )
    )
    got = [
        (t["title"], t["list_id"], t["due_date"], t["due_time"]) for t in res["tasks"]
    ]
    assert got == [
        ("Eggs", lists["Groceries"], None, None),
        ("Rice", lists["Groceries"], None, None),
        ("Call Mark", None, day(1), "15:00"),
        ("Email client", lists["Work"], day(0), None),
    ]
    assert all(t["source"] == "capture-voice" for t in res["tasks"])
    call_mark = res["tasks"][2]
    assert call_mark["remind_at"] is not None  # dated, not vague, not groceries
    assert res["tasks"][3]["remind_at"] is None  # vague: the follow-up asks
    assert res["follow_up"] == res["tasks"][3]["id"]

    ok(
        client.post(
            f"{API}/remove",
            headers=headers,
            json={"ids": [t["id"] for t in res["tasks"]]},
        )
    )
    assert ok(client.get(f"{API}/?status=all", headers=headers))["count"] == 0
    assert ok(client.get(f"{API}/deleted", headers=headers))["count"] == 0
    assert _events(db, call_mark["id"]) == []


def test_parse_preview(client: TestClient, db: Session) -> None:
    _, headers = signed_in(db)
    p = ok(
        client.post(
            f"{API}/parse", headers=headers, json={"text": "dentist tomorrow 10am"}
        )
    )
    assert (p["title"], p["due_date"], p["due_time"]) == ("Dentist", day(1), "10:00")
    bad = ok(
        client.post(f"{API}/parse", headers=headers, json={"text": "thing nov 45"})
    )
    assert bad["due_date"] is None


# ---------------------------------------------------------------- reads


def test_search_filters_and_sorts(client: TestClient, db: Session) -> None:
    _, headers = signed_in(db)
    lst = new_list(client, headers, "Work")
    new_task(client, headers, "Finish deck", list_id=lst["id"], due_date=day(2))
    new_task(client, headers, "Call Mark", notes="about the DECK", starred=True)
    done = new_task(client, headers, "Old deck", due_date=day(-1))
    ok(client.post(f"{API}/{done['id']}/complete", headers=headers))
    new_task(client, headers, "100%_literal")

    def titles(qs: str) -> list[str]:
        return [
            t["title"]
            for t in ok(client.get(f"{API}/search?{qs}", headers=headers))["data"]
        ]

    assert titles("q=deck") == ["Finish deck", "Call Mark"]
    assert titles("q=deck&status=all") == ["Old deck", "Finish deck", "Call Mark"]
    assert titles("q=deck&status=done") == ["Old deck"]
    assert titles(f"q=deck&list_id={lst['id']}") == ["Finish deck"]
    assert titles("inbox=true&starred=true") == ["Call Mark"]
    assert titles("has_date=true&status=all") == ["Old deck", "Finish deck"]
    assert titles("q=%25_") == ["100%_literal"]  # LIKE wildcards are literal
    assert titles("q=_l") == ["100%_literal"]


def test_completed_log_groups_by_day(client: TestClient, db: Session) -> None:
    _, headers = signed_in(db)
    a = new_task(client, headers, "a")
    b = new_task(client, headers, "b")
    old = (datetime.now().astimezone() - timedelta(days=3)).isoformat()
    ok(client.post(f"{API}/{a['id']}/complete", headers=headers))
    ok(
        client.post(
            f"{API}/{b['id']}/complete", headers=headers, json={"completed_at": old}
        )
    )
    log = ok(client.get(f"{API}/completed?days=14", headers=headers))
    assert [(g["day"], [t["title"] for t in g["tasks"]]) for g in log["data"]] == [
        (day(0), ["a"]),
        (day(-3), ["b"]),
    ]
    assert ok(client.get(f"{API}/completed?days=2", headers=headers))["count"] == 1


def test_today_view(client: TestClient, db: Session) -> None:
    _, headers = signed_in(db)
    empty = ok(client.get(f"{API}/today", headers=headers))
    assert empty["ever_had_tasks"] is False
    shop = new_list(client, headers, "Groceries", kind="shopping")
    over = new_task(client, headers, "over", due_date=day(-1))
    due = new_task(client, headers, "due", due_date=day(0), starred=True)
    up = new_task(client, headers, "up", due_date=day(3))
    new_task(client, headers, "eggs", list_id=shop["id"], due_date=day(0))
    done = new_task(client, headers, "done", due_date=day(0))
    ok(client.post(f"{API}/{done['id']}/complete", headers=headers))
    v = ok(client.get(f"{API}/today", headers=headers))
    assert v["day"] == today().isoformat()
    assert [t["id"] for t in v["overdue"]] == [over["id"]]
    assert [t["id"] for t in v["due"]] == [due["id"]]
    assert [t["id"] for t in v["done_due_today"]] == [done["id"]]
    assert [t["id"] for t in v["upcoming"][2]["tasks"]] == [up["id"]]
    assert v["shopping_open"] == 1
    assert (v["progress_due"], v["progress_done"]) == (3, 1)


def test_stats_and_share(client: TestClient, db: Session) -> None:
    _, headers = signed_in(db)
    on_time = new_task(client, headers, "on time", due_date=day(0))
    late = new_task(client, headers, "late", due_date=day(-2))
    new_task(client, headers, "overdue", due_date=day(-1))
    ok(client.post(f"{API}/{on_time['id']}/complete", headers=headers))
    ok(client.post(f"{API}/{late['id']}/complete", headers=headers))
    s = ok(client.get(f"{API}/stats?days=7", headers=headers))["current"]
    assert (s["done"], s["on_time"], s["late"], s["overdue_now"]) == (2, 1, 1, 1)
    assert s["on_time_rate"] == 0.5
    assert s["follow_through"] == pytest.approx((1 + 0.5 * 1) / 1)
    assert s["streak"] == 1
    assert s["avg_lateness"] == 2
    share = ok(client.get(f"{API}/share?days=7", headers=headers))
    assert (
        share["caption"]
        == "Tasks this week: 2 done · 50% on time · 1 day streak · Personal SOP"
    )
    assert [m["key"] for m in share["metrics"] if m["default_on"]] == [
        "done",
        "onTime",
        "streak",
    ]
    assert client.get(f"{API}/stats?days=0", headers=headers).status_code == 422


# ---------------------------------------------------------------- settings


def test_settings_and_notif_defaults_then_patch(
    client: TestClient, db: Session
) -> None:
    _, headers = signed_in(db)
    s = ok(client.get(f"{API}/settings", headers=headers))
    # the prototype's defaults: digest off, groceries counted
    assert (s["digest_on"], s["count_groceries"], s["default_remind_time"]) == (
        False,
        True,
        "09:00",
    )
    s2 = ok(
        client.patch(
            f"{API}/settings",
            headers=headers,
            json={"digest_on": True, "quiet_start": "23:00"},
        )
    )
    assert (s2["digest_on"], s2["quiet_start"], s2["id"]) == (True, "23:00", s["id"])
    assert (
        client.patch(
            f"{API}/settings", headers=headers, json={"digest_time": "7am"}
        ).status_code
        == 422
    )
    assert (
        client.patch(
            f"{API}/settings", headers=headers, json={"digest_on": None}
        ).status_code
        == 422
    )
    n = ok(client.get(f"{API}/notif", headers=headers))
    assert (n["permission"], n["installed"]) == ("default", False)
    n2 = ok(
        client.patch(
            f"{API}/notif",
            headers=headers,
            json={"permission": "granted", "installed": True},
        )
    )
    assert (n2["permission"], n2["installed"]) == ("granted", True)
