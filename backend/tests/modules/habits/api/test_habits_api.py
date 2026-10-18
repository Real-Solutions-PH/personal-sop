"""Habits and logs over HTTP: CRUD, isolation, permissions, logging rules."""

import uuid
from datetime import date, timedelta

from fastapi.testclient import TestClient
from sqlmodel import Session

from tests.modules.habits.api.util import API, err, make_habit, ok, today
from tests.utils.mobile import signed_in
from tests.utils.user import create_auth_user, user_authentication_headers


def test_habit_crud_list_and_pagination(client: TestClient, db: Session) -> None:
    _, h = signed_in(db)
    hid = str(uuid.uuid4())
    created = make_habit(
        client,
        h,
        id=hid,
        name="Meditate",
        type="duration",
        target=10,
        schedule=[{"days": [1, 3, 5], "time": "06:45", "window": 30}],
    )
    assert created["id"] == hid
    assert created["status"] == "active"
    # A replayed create with the same client id returns the same row.
    again = make_habit(client, h, id=hid, name="Something else")
    assert (again["id"], again["name"]) == (hid, "Meditate")

    second = make_habit(client, h, name="Water", type="count", target=8, unit="glasses")
    assert second["schedule"] == [{"days": [0, 1, 2, 3, 4, 5, 6]}]
    assert second["sort_order"] > created["sort_order"]

    patched = ok(
        client.patch(
            f"{API}/{hid}",
            headers=h,
            json={"name": "Meditate 10m", "schedule": [{"days": [0, 6]}]},
        )
    )
    assert patched["name"] == "Meditate 10m"
    assert patched["schedule"] == [{"days": [0, 6]}]

    detail = ok(client.get(f"{API}/{hid}", headers=h, params={"days": 14}))
    assert detail["habit"]["id"] == hid
    assert len(detail["heat"]) == 14
    assert detail["log_count"] == 0

    page = ok(client.get(f"{API}/", headers=h))
    assert page["count"] == 2
    assert [r["habit"]["name"] for r in page["data"]] == ["Meditate 10m", "Water"]
    empty = ok(client.get(f"{API}/", headers=h, params={"limit": 0}))
    assert (empty["data"], empty["count"]) == ([], 2)
    one = ok(client.get(f"{API}/", headers=h, params={"skip": 1, "limit": 1}))
    assert [r["habit"]["name"] for r in one["data"]] == ["Water"]
    err(client.get(f"{API}/", headers=h, params={"limit": 101}), 422)
    err(client.get(f"{API}/", headers=h, params={"skip": -1}), 422)


def test_invalid_habit_bodies_are_422(client: TestClient, db: Session) -> None:
    _, h = signed_in(db)
    for body in (
        {"name": ""},
        {"name": "x", "schedule": [{"days": [7]}]},
        {"name": "x", "schedule": [{"days": []}]},
        {"name": "x", "schedule": [{"days": [1], "time": "25:00"}]},
        {"name": "x", "schedule": [{"days": [1, 1]}]},
        {"name": "x", "schedule": [{"days": [1]}, {"days": [1, 2]}]},
        {"name": "x", "type": "weekly"},
        {"name": "x", "target": 0},
    ):
        err(client.post(f"{API}/", headers=h, json=body), 422)


def test_unknown_ids_are_404(client: TestClient, db: Session) -> None:
    _, h = signed_in(db)
    missing = uuid.uuid4()
    err(client.get(f"{API}/{missing}", headers=h), 404, "habit_not_found")
    err(client.post(f"{API}/{missing}/check", headers=h, json={}), 404)
    err(client.delete(f"{API}/logs/{missing}", headers=h), 404, "habit_log_not_found")
    err(client.get(f"{API}/routines/{missing}", headers=h), 404, "routine_not_found")
    err(client.get(f"{API}/runs/{missing}", headers=h), 404)


def test_another_user_cannot_read_or_change_my_rows(
    client: TestClient, db: Session
) -> None:
    _, a = signed_in(db)
    _, b = signed_in(db)
    habit = make_habit(client, a, name="Mine")
    log = ok(client.post(f"{API}/{habit['id']}/check", headers=a, json={}))
    hid = habit["id"]
    err(client.get(f"{API}/{hid}", headers=b), 404)
    err(client.patch(f"{API}/{hid}", headers=b, json={"name": "Theirs"}), 404)
    err(client.post(f"{API}/{hid}/check", headers=b, json={}), 404)
    err(client.delete(f"{API}/{hid}", headers=b), 404)
    err(client.delete(f"{API}/logs/{log['id']}", headers=b), 404)
    err(client.post(f"{API}/{hid}/timer", headers=b), 404)
    assert ok(client.get(f"{API}/", headers=b))["count"] == 0
    assert ok(client.get(f"{API}/{hid}", headers=a))["habit"]["name"] == "Mine"


def test_role_less_user_is_403(client: TestClient, db: Session) -> None:
    user, password = create_auth_user(db, assign_default_role=False)
    h = user_authentication_headers(email=user.email, password=password)
    err(client.get(f"{API}/", headers=h), 403)
    err(client.post(f"{API}/", headers=h, json={"name": "x"}), 403)
    err(client.get(f"{API}/home", headers=h), 403)


def test_logging_rules(client: TestClient, db: Session) -> None:
    _, h = signed_in(db)
    water = make_habit(client, h, name="Water", type="count", target=8, step=1)
    wid = water["id"]
    first = ok(client.post(f"{API}/{wid}/increment", headers=h, json={}))
    assert (first["status"], first["value"]) == ("partial", 1)
    second = ok(client.post(f"{API}/{wid}/increment", headers=h, json={"by": 7}))
    assert (second["id"], second["status"], second["value"]) == (first["id"], "done", 8)

    check = make_habit(client, h, name="Journal")
    done = ok(client.post(f"{API}/{check['id']}/check", headers=h, json={}))
    assert (done["status"], done["value"], done["source"]) == ("done", None, "tap")

    skipped = ok(client.post(f"{API}/{wid}/skip", headers=h, json={"note": "Rest day"}))
    assert skipped["id"] == first["id"]
    assert (skipped["status"], skipped["value"], skipped["note"]) == (
        "skipped",
        None,
        "Rest day",
    )
    # A partial log with an explicit value; the note survives a re-log.
    edited = ok(
        client.post(
            f"{API}/{wid}/log", headers=h, json={"value": 3, "source": "capture"}
        )
    )
    assert (edited["status"], edited["value"], edited["note"]) == (
        "partial",
        3,
        "Rest day",
    )

    d = date.fromisoformat(today(client, h))
    backfill = ok(
        client.post(
            f"{API}/{wid}/log",
            headers=h,
            json={"day": str(d - timedelta(days=3)), "value": 9},
        )
    )
    assert backfill["status"] == "done"
    err(
        client.post(
            f"{API}/{wid}/log", headers=h, json={"day": str(d + timedelta(days=1))}
        ),
        422,
        "log_day_in_future",
    )
    err(client.post(f"{API}/{wid}/log", headers=h, json={"value": -1}), 422)
    logs = ok(client.get(f"{API}/{wid}/logs", headers=h))
    assert logs["count"] == 2


def test_undo_then_relog_on_the_same_day_revives_the_row(
    client: TestClient, db: Session
) -> None:
    _, h = signed_in(db)
    hid = make_habit(client, h, name="Workout")["id"]
    first = ok(client.post(f"{API}/{hid}/check", headers=h, json={}))
    cleared = ok(client.delete(f"{API}/{hid}/log", headers=h))
    assert cleared["id"] == first["id"]
    assert ok(client.get(f"{API}/{hid}/logs", headers=h))["count"] == 0
    err(client.delete(f"{API}/{hid}/log", headers=h), 404, "habit_log_not_found")

    again = ok(client.post(f"{API}/{hid}/skip", headers=h, json={}))
    assert again["id"] == first["id"]
    assert again["status"] == "skipped"
    assert again["version"] > first["version"]
    assert ok(client.get(f"{API}/{hid}/logs", headers=h))["count"] == 1

    # Delete by id, then restore the same row.
    ok(client.delete(f"{API}/logs/{first['id']}", headers=h))
    restored = ok(client.post(f"{API}/logs/{first['id']}/restore", headers=h))
    assert (restored["id"], restored["status"]) == (first["id"], "skipped")


def test_pause_resume_archive_restore_delete(client: TestClient, db: Session) -> None:
    _, h = signed_in(db)
    hid = make_habit(client, h, name="Run")["id"]
    ok(client.post(f"{API}/{hid}/check", headers=h, json={}))
    d = date.fromisoformat(today(client, h))
    err(
        client.post(f"{API}/{hid}/pause", headers=h, json={"until": str(d)}),
        422,
        "pause_until_past",
    )
    paused = ok(
        client.post(
            f"{API}/{hid}/pause",
            headers=h,
            json={"until": str(d + timedelta(days=3)), "reason": "Sick"},
        )
    )
    assert paused["status"] == "paused"
    detail = ok(client.get(f"{API}/{hid}", headers=h))
    assert detail["effective_status"] == "paused"
    assert detail["current_pause"]["to_day"] == str(d + timedelta(days=2))
    listed = ok(client.get(f"{API}/", headers=h, params={"status": "paused"}))
    assert [r["habit"]["id"] for r in listed["data"]] == [hid]

    resumed = ok(client.post(f"{API}/{hid}/resume", headers=h))
    assert resumed["status"] == "active"
    # The pause started today, so resuming removes it entirely.
    assert ok(client.get(f"{API}/{hid}", headers=h))["pauses"] == []

    ok(client.post(f"{API}/{hid}/archive", headers=h))
    assert ok(client.get(f"{API}/", headers=h))["count"] == 0
    archived = ok(client.get(f"{API}/archived", headers=h))
    assert archived["count"] == 1
    assert archived["data"][0]["log_count"] == 1
    ok(client.post(f"{API}/{hid}/restore", headers=h))
    assert ok(client.get(f"{API}/", headers=h))["count"] == 1

    ok(client.delete(f"{API}/{hid}", headers=h))
    err(client.get(f"{API}/{hid}", headers=h), 404)
    assert ok(client.get(f"{API}/archived", headers=h))["count"] == 0


def test_reorder_swaps_with_the_neighbour(client: TestClient, db: Session) -> None:
    _, h = signed_in(db)
    ids = [make_habit(client, h, name=n)["id"] for n in ("A", "B", "C")]
    ok(client.post(f"{API}/{ids[2]}/reorder", headers=h, json={"dir": -1}))
    names = [r["habit"]["name"] for r in ok(client.get(f"{API}/", headers=h))["data"]]
    assert names == ["A", "C", "B"]
    # Past the top is a no-op.
    ok(client.post(f"{API}/{ids[0]}/reorder", headers=h, json={"dir": -1}))
    names = [r["habit"]["name"] for r in ok(client.get(f"{API}/", headers=h))["data"]]
    assert names == ["A", "C", "B"]
    err(client.post(f"{API}/{ids[0]}/reorder", headers=h, json={"dir": 2}), 422)


def test_settings_default_then_patch(client: TestClient, db: Session) -> None:
    _, h = signed_in(db)
    assert ok(client.get(f"{API}/settings", headers=h)) == {
        "week_start": 1,
        "default_reminder": False,
        "streak_nudge": True,
    }
    ok(
        client.patch(
            f"{API}/settings",
            headers=h,
            json={"week_start": 0, "default_reminder": True},
        )
    )
    assert ok(client.get(f"{API}/settings", headers=h))["week_start"] == 0
    # The default reminder now applies to new habits.
    assert make_habit(client, h, name="Floss")["reminder"] is True
    err(client.patch(f"{API}/settings", headers=h, json={"week_start": 3}), 422)


def test_day_editor_sets_and_clears(client: TestClient, db: Session) -> None:
    _, h = signed_in(db)
    a = make_habit(client, h, name="A")["id"]
    b = make_habit(client, h, name="B", type="count", target=4)["id"]
    d = today(client, h)
    saved = ok(
        client.put(
            f"{API}/day/{d}",
            headers=h,
            json={
                "entries": [
                    {"habit_id": a, "status": "done"},
                    {"habit_id": b, "status": "partial", "value": 2, "note": "meh"},
                ]
            },
        )
    )
    by = {x["habit"]["id"]: x for x in saved["habits"]}
    assert by[a]["log"]["status"] == "done"
    assert (by[b]["log"]["value"], by[b]["cell"]) == (2, "partial")
    cleared = ok(
        client.put(f"{API}/day/{d}", headers=h, json={"entries": [{"habit_id": a}]})
    )
    by = {x["habit"]["id"]: x for x in cleared["habits"]}
    assert by[a]["log"] is None
    assert by[a]["cell"] == "pending"
    future = str(date.fromisoformat(d) + timedelta(days=1))
    err(
        client.put(f"{API}/day/{future}", headers=h, json={"entries": []}),
        422,
        "log_day_in_future",
    )


def test_today_and_home(client: TestClient, db: Session) -> None:
    _, h = signed_in(db)
    a = make_habit(client, h, name="A")["id"]
    make_habit(client, h, name="B")
    ok(client.post(f"{API}/{a}/check", headers=h, json={}))
    t = ok(client.get(f"{API}/today", headers=h))
    assert (t["due"], t["done"]) == (2, 1)
    groups = {x["habit"]["name"]: x["group"] for x in t["habits"]}
    assert groups == {"A": "done", "B": "anytime"}

    home = ok(client.get(f"{API}/home", headers=h, params={"days": 7, "sort": "name"}))
    assert home["current"]["done"] == 1
    assert [p["habit"]["name"] for p in home["ranked"]] == ["A", "B"]
    assert len(home["series"]) == 7
    assert len(home["weekly_minutes"]) == 8
    err(client.get(f"{API}/home", headers=h, params={"days": 0}), 422)
