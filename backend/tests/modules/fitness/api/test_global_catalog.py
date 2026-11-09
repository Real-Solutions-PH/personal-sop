"""Built-in (global) and own exercises and routines.

Built-in rows are every member's and nobody's to change; a member's own rows
are theirs alone. Each test runs in a tenant of its own (``own_tenant``)."""

import uuid
from datetime import timedelta
from typing import Any

from fastapi.testclient import TestClient
from sqlalchemy import text
from sqlmodel import Session

from app.core.db import engine
from app.modules.fitness.models import Exercise, TemplateItem, WorkoutTemplate
from app.shared.owned import utcnow
from tests.modules.fitness.api.helpers import API, err, finished_workout, ok
from tests.modules.fitness.api.test_sync_fitness import op, pull_all, push
from tests.utils.mobile import signed_in
from tests.utils.tenant import fresh_tenant
from tests.utils.user import create_auth_user
from tests.utils.utils import auth_headers

EX_BODY = {"equipment": "barbell", "muscle": "chest"}


def _own_exercise(client: TestClient, h: dict[str, str], name: str) -> dict[str, Any]:
    return dict(
        ok(client.post(f"{API}/exercises", headers=h, json={"name": name, **EX_BODY}))
    )


def _own_template(
    client: TestClient, h: dict[str, str], name: str, ex_ids: list[str]
) -> dict[str, Any]:
    return dict(
        ok(
            client.post(
                f"{API}/templates",
                headers=h,
                json={"name": name, "items": [{"exercise_id": e} for e in ex_ids]},
            )
        )
    )


def _exercises(client: TestClient, h: dict[str, str]) -> dict[str, dict[str, Any]]:
    data = ok(client.get(f"{API}/exercises?include_archived=true", headers=h))["data"]
    return {e["name"]: e for e in data}


def _templates(client: TestClient, h: dict[str, str]) -> dict[str, dict[str, Any]]:
    return {t["name"]: t for t in ok(client.get(f"{API}/templates", headers=h))["data"]}


def _version(model: Any, row_id: str) -> int:
    with Session(engine) as s:
        row = s.get(model, uuid.UUID(row_id))
        assert row is not None
        return int(row.version)


def test_lists_show_own_and_built_in_never_another_members(
    client: TestClient, db: Session
) -> None:
    _, h1 = signed_in(db)
    _, h2 = signed_in(db)
    built_in = _exercises(client, h1)
    assert len(built_in) == 14 and all(e["is_global"] for e in built_in.values())
    bench = built_in["Barbell Bench Press"]["id"]
    mine = _own_exercise(client, h1, "Sled push")
    assert mine["is_global"] is False
    t = _own_template(client, h1, "Sled day", [mine["id"], bench])
    assert t["is_global"] is False

    first = _exercises(client, h1)
    assert set(first) == set(built_in) | {"Sled push"}
    assert first["Sled push"]["is_global"] is False
    second = _exercises(client, h2)
    assert set(second) == set(built_in)
    assert {n for n, x in _templates(client, h1).items() if not x["is_global"]} == {
        "Sled day"
    }
    theirs = _templates(client, h2)
    assert set(theirs) == {"Push A", "Pull A", "Legs A"}
    assert all(x["is_global"] for x in theirs.values())
    # Another member's row is simply not there.
    err(
        client.get(f"{API}/exercises/{mine['id']}", headers=h2),
        404,
        "exercise_not_found",
    )
    err(client.get(f"{API}/templates/{t['id']}", headers=h2), 404, "template_not_found")
    assert ok(client.get(f"{API}/exercises?q=sled", headers=h2))["count"] == 0
    # Nor does it reach their phone.
    pulled = {c["id"]: c for c in pull_all(client, h2)}
    assert mine["id"] not in pulled and t["id"] not in pulled
    assert pulled[bench]["row"]["is_global"] is True


def test_built_in_rows_refuse_edits_and_deletes(
    client: TestClient, db: Session
) -> None:
    user, h = signed_in(db)
    ex = _exercises(client, h)
    bench, ohp = ex["Barbell Bench Press"]["id"], ex["Overhead Press"]["id"]
    push_a = _templates(client, h)["Push A"]
    before = (_version(Exercise, bench), _version(WorkoutTemplate, push_a["id"]))
    put = {"name": "Renamed", **EX_BODY}
    err(
        client.put(f"{API}/exercises/{bench}", headers=h, json=put),
        403,
        "catalog_read_only",
    )
    err(
        client.post(
            f"{API}/exercises/{bench}/archive", headers=h, json={"archived": True}
        ),
        403,
        "catalog_read_only",
    )
    err(
        client.post(
            f"{API}/exercises/{bench}/merge", headers=h, json={"target_id": ohp}
        ),
        403,
        "catalog_read_only",
    )
    err(
        client.put(
            f"{API}/templates/{push_a['id']}",
            headers=h,
            json={"name": "Mine now", "items": [{"exercise_id": ohp}]},
        ),
        403,
        "catalog_read_only",
    )
    err(
        client.delete(f"{API}/templates/{push_a['id']}", headers=h),
        403,
        "catalog_read_only",
    )
    # Admins too: built-ins change only through migrations.
    user.is_superuser = True
    db.add(user)
    db.commit()
    err(
        client.put(f"{API}/exercises/{bench}", headers=h, json=put),
        403,
        "catalog_read_only",
    )
    assert (
        _version(Exercise, bench),
        _version(WorkoutTemplate, push_a["id"]),
    ) == before
    assert _exercises(client, h)["Barbell Bench Press"]["name"] == "Barbell Bench Press"
    assert len(_templates(client, h)["Push A"]["items"]) == len(push_a["items"])


def test_sync_refuses_writes_to_built_in_rows(client: TestClient, db: Session) -> None:
    _, h = signed_in(db)
    bench = _exercises(client, h)["Barbell Bench Press"]["id"]
    push_a = _templates(client, h)["Push A"]["id"]
    with Session(engine) as s:
        slot = s.exec(
            text(
                "SELECT id FROM template_item WHERE template_id = :t AND position = 0"
            ),
            params={"t": push_a},
        ).one()[0]
    before = (
        _version(Exercise, bench),
        _version(WorkoutTemplate, push_a),
        _version(TemplateItem, str(slot)),
    )
    results = push(
        client,
        h,
        op("upsert", "exercise", bench, name="Mine", archived=True),
        op("delete", "exercise", bench),
        op("upsert", "workout_template", push_a, name="Mine"),
        op("delete", "workout_template", push_a),
        op("upsert", "template_item", slot, sets=9),
        op("delete", "template_item", slot),
        op(
            "upsert",
            "template_item",
            uuid.uuid4(),
            template_id=push_a,
            exercise_id=bench,
            position=40,
            sets=3,
        ),
        op("action", "fitness.merge_exercises", source_id=bench, target_id=bench),
    )
    statuses = [(r["status"], r["code"]) for r in results]
    assert statuses[:7] == [("rejected", "catalog_read_only")] * 7, statuses
    assert statuses[7][0] == "rejected"
    assert (
        _version(Exercise, bench),
        _version(WorkoutTemplate, push_a),
        _version(TemplateItem, str(slot)),
    ) == before


def test_owner_crud_and_using_built_ins(client: TestClient, db: Session) -> None:
    user, h = signed_in(db)
    ex = _exercises(client, h)
    bench, squat = ex["Barbell Bench Press"]["id"], ex["Back Squat"]["id"]
    mine = _own_exercise(client, h, "Landmine press")
    upd = ok(
        client.put(
            f"{API}/exercises/{mine['id']}",
            headers=h,
            json={"name": "Landmine press", **EX_BODY, "increment": 5},
        )
    )
    assert upd["increment"] == 5 and upd["is_global"] is False
    ok(
        client.post(
            f"{API}/exercises/{mine['id']}/archive", headers=h, json={"archived": True}
        )
    )
    ok(
        client.post(
            f"{API}/exercises/{mine['id']}/archive", headers=h, json={"archived": False}
        )
    )
    # A routine of my own may use built-in exercises; I edit and delete it.
    t = _own_template(client, h, "Upper", [bench, mine["id"]])
    t2 = ok(
        client.put(
            f"{API}/templates/{t['id']}",
            headers=h,
            json={"name": "Upper B", "items": [{"exercise_id": squat, "sets": 4}]},
        )
    )
    assert [(i["exercise_name"], i["sets"]) for i in t2["items"]] == [("Back Squat", 4)]
    ok(client.delete(f"{API}/templates/{t['id']}", headers=h))
    err(client.get(f"{API}/templates/{t['id']}", headers=h), 404, "template_not_found")
    ok(client.post(f"{API}/templates/{t['id']}/restore", headers=h))
    # A built-in routine starts a workout like any other...
    push_a = _templates(client, h)["Push A"]
    started = ok(
        client.post(
            f"{API}/workouts/start",
            headers=h,
            json={"source": "template", "template_id": push_a["id"]},
        )
    )
    assert len(started["workout"]["exercises"]) == len(push_a["items"])
    ok(client.post(f"{API}/workouts/{started['workout']['id']}/discard", headers=h))
    # ...and copies into one of my own to customise.
    copy = ok(client.post(f"{API}/templates/{push_a['id']}/copy", headers=h, json={}))
    assert copy["name"] == "Push A (copy)" and copy["is_global"] is False
    assert [i["exercise_id"] for i in copy["items"]] == [
        i["exercise_id"] for i in push_a["items"]
    ]
    edited = ok(
        client.put(
            f"{API}/templates/{copy['id']}",
            headers=h,
            json={"name": "My push", "items": [{"exercise_id": mine["id"]}]},
        )
    )
    assert edited["name"] == "My push"
    assert len(_templates(client, h)["Push A"]["items"]) == len(push_a["items"])
    # Logging a built-in exercise is mine to do, and its history is mine.
    finished_workout(
        user,
        started_at=utcnow() - timedelta(days=1),
        lifts=[(uuid.UUID(bench), [(5, 80)])],
    )
    assert len(ok(client.get(f"{API}/exercises/{bench}", headers=h))["history"]) == 1


def test_another_members_rows_cannot_be_changed(
    client: TestClient, db: Session
) -> None:
    _, h1 = signed_in(db)
    _, h2 = signed_in(db)
    mine = _own_exercise(client, h1, "Zercher squat")
    t = _own_template(client, h1, "Zercher day", [mine["id"]])
    before = (_version(Exercise, mine["id"]), _version(WorkoutTemplate, t["id"]))
    r = client.put(
        f"{API}/exercises/{mine['id']}", headers=h2, json={"name": "Taken", **EX_BODY}
    )
    assert r.status_code == 409, r.text  # the id is taken; nothing is revealed
    err(
        client.delete(f"{API}/templates/{t['id']}", headers=h2),
        404,
        "template_not_found",
    )
    err(
        client.post(
            f"{API}/exercises/{mine['id']}/archive", headers=h2, json={"archived": True}
        ),
        404,
        "exercise_not_found",
    )
    err(
        client.post(f"{API}/templates/{t['id']}/copy", headers=h2, json={}),
        404,
        "template_not_found",
    )
    # Using it in a routine of one's own is refused too.
    err(
        client.post(
            f"{API}/templates",
            headers=h2,
            json={"name": "Borrowed", "items": [{"exercise_id": mine["id"]}]},
        ),
        404,
        "exercise_not_found",
    )
    results = push(
        client,
        h2,
        op("upsert", "exercise", mine["id"], name="Taken"),
        op("delete", "workout_template", t["id"]),
    )
    assert results[0]["status"] == "rejected"
    assert results[1]["status"] == "applied"  # an unknown row's delete is a no-op
    assert (
        _version(Exercise, mine["id"]),
        _version(WorkoutTemplate, t["id"]),
    ) == before
    assert (
        ok(client.get(f"{API}/templates/{t['id']}", headers=h1))["name"]
        == "Zercher day"
    )


def test_other_tenants_see_neither_built_ins_nor_own_rows(
    client: TestClient, db: Session
) -> None:
    _, h1 = signed_in(db)
    built_in = _exercises(client, h1)
    mine = _own_exercise(client, h1, "Meadows row")
    other, password = create_auth_user(db, tenant_id=fresh_tenant(db))
    h3 = auth_headers(other.email, password)
    theirs = _exercises(client, h3)  # their tenant seeds its own built-ins
    assert set(theirs) == set(built_in)
    assert not {e["id"] for e in theirs.values()} & {e["id"] for e in built_in.values()}
    bench = built_in["Barbell Bench Press"]["id"]
    err(client.get(f"{API}/exercises/{bench}", headers=h3), 404, "exercise_not_found")
    err(
        client.get(f"{API}/exercises/{mine['id']}", headers=h3),
        404,
        "exercise_not_found",
    )
    pulled = {c["id"] for c in pull_all(client, h3)}
    assert bench not in pulled and mine["id"] not in pulled


def test_deleting_a_member_keeps_built_ins_and_drops_their_own(
    client: TestClient, db: Session
) -> None:
    u1, h1 = signed_in(db)  # the first touch: authors the built-ins
    _, h2 = signed_in(db)
    bench = _exercises(client, h1)["Barbell Bench Press"]["id"]
    mine = _own_exercise(client, h1, "Pendlay row")
    _own_template(client, h1, "Pendlay day", [mine["id"], bench])
    finished_workout(
        u1,
        started_at=utcnow() - timedelta(days=1),
        lifts=[(uuid.UUID(mine["id"]), [(5, 60)]), (uuid.UUID(bench), [(5, 80)])],
    )
    with Session(engine) as s:
        s.exec(text('DELETE FROM "user" WHERE id = :u'), params={"u": u1.id})
        s.commit()
        assert s.get(Exercise, uuid.UUID(mine["id"])) is None
        kept = s.get(Exercise, uuid.UUID(bench))
        assert kept is not None and kept.is_global
    assert "Barbell Bench Press" in _exercises(client, h2)
