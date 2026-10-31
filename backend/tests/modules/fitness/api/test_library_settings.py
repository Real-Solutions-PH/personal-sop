"""Exercises, templates, settings, the hub and the two resets."""

import uuid
from datetime import timedelta

from fastapi.testclient import TestClient
from sqlmodel import Session

from app.modules.profile import public as profile_public
from app.shared.owned import utcnow
from tests.modules.fitness.api.helpers import (
    API,
    err,
    exercise_ids,
    finished_workout,
    ok,
)
from tests.utils.mobile import ctx_for, signed_in


def test_new_user_gets_the_library_split_and_defaults(
    client: TestClient, db: Session
) -> None:
    _, h = signed_in(db)
    st = ok(client.get(f"{API}/settings", headers=h))
    assert (st["units"], st["rest_sec"], st["weekly_target"], st["progression"]) == (
        "kg",
        120,
        4,
        "double",
    )
    lib = ok(client.get(f"{API}/exercises", headers=h))
    assert lib["count"] == 13  # the archived Plank is hidden
    assert (
        ok(client.get(f"{API}/exercises?include_archived=true", headers=h))["count"]
        == 14
    )
    names = [t["name"] for t in ok(client.get(f"{API}/templates", headers=h))["data"]]
    assert names == ["Push A", "Pull A", "Legs A"]
    # A second read seeds nothing twice.
    ok(client.get(f"{API}/settings", headers=h))
    assert ok(client.get(f"{API}/exercises", headers=h))["count"] == 13


def test_exercise_crud_search_and_archive(client: TestClient, db: Session) -> None:
    _, h = signed_in(db)
    ok(client.get(f"{API}/settings", headers=h))
    new_id = str(uuid.uuid4())
    ex = ok(
        client.post(
            f"{API}/exercises",
            headers=h,
            json={
                "id": new_id,
                "name": "  Hip Thrust ",
                "equipment": "barbell",
                "muscle": "glutes",
                "rep_min": 8,
                "rep_max": 12,
            },
        )
    )
    assert ex["id"] == new_id and ex["name"] == "Hip Thrust"
    err(
        client.put(
            f"{API}/exercises/{new_id}",
            headers=h,
            json={"name": "Hip Thrust", "rep_min": 10, "rep_max": 6},
        ),
        422,
        "invalid_rep_range",
    )
    upd = ok(
        client.put(
            f"{API}/exercises/{new_id}",
            headers=h,
            json={"name": "Hip Thrust", "muscle": "glutes", "increment": 5},
        )
    )
    assert upd["increment"] == 5
    assert [
        e["name"]
        for e in ok(client.get(f"{API}/exercises?muscle=glutes", headers=h))["data"]
    ] == ["Hip Thrust"]
    assert ok(client.get(f"{API}/exercises?q=thrust", headers=h))["count"] == 1
    ok(
        client.post(
            f"{API}/exercises/{new_id}/archive", headers=h, json={"archived": True}
        )
    )
    assert ok(client.get(f"{API}/exercises?q=thrust", headers=h))["count"] == 0
    detail = ok(client.get(f"{API}/exercises/{new_id}", headers=h))
    assert (
        detail["archived"] is True
        and detail["history"] == []
        and detail["suggestion"]["kind"] == "new"
    )
    assert (
        client.post(
            f"{API}/exercises", headers=h, json={"name": "x", "muscle": "neck"}
        ).status_code
        == 422
    )


def test_exercise_detail_has_history_prs_and_suggestion(
    client: TestClient, db: Session
) -> None:
    user, h = signed_in(db)
    ids = exercise_ids(client, h)
    bench = uuid.UUID(ids["Barbell Bench Press"])
    finished_workout(
        user,
        started_at=utcnow() - timedelta(days=6),
        lifts=[(bench, [(8, 60), (8, 60)])],
    )
    finished_workout(
        user,
        started_at=utcnow() - timedelta(days=2),
        lifts=[(bench, [(10, 60), (10, 60)])],
    )
    d = ok(client.get(f"{API}/exercises/{bench}", headers=h))
    assert [p["best_e1rm"] for p in d["history"]] == [
        60 * (1 + 8 / 30),
        60 * (1 + 10 / 30),
    ]
    assert [p["kind"] for p in d["prs"]] == ["e1rm"]
    assert d["suggestion"]["kind"] == "weight" and d["suggestion"]["weight"] == 62.5
    assert d["suggestion"]["badge"] == "+2.5 kg"


def test_template_crud_and_save_as_template(client: TestClient, db: Session) -> None:
    user, h = signed_in(db)
    ids = exercise_ids(client, h)
    a, b, c = ids["Back Squat"], ids["Leg Press"], ids["Romanian Deadlift"]
    t = ok(
        client.post(
            f"{API}/templates",
            headers=h,
            json={
                "name": "Legs B",
                "items": [{"exercise_id": a, "sets": 5}, {"exercise_id": b}],
            },
        )
    )
    assert [(i["exercise_name"], i["sets"]) for i in t["items"]] == [
        ("Back Squat", 5),
        ("Leg Press", 3),
    ]
    assert t["sort_order"] == 3
    # Rewrite: reorder and shrink; the dropped slot is tombstoned.
    t2 = ok(
        client.put(
            f"{API}/templates/{t['id']}",
            headers=h,
            json={"name": "Legs B2", "items": [{"exercise_id": c, "sets": 4}]},
        )
    )
    assert [(i["exercise_name"], i["sets"]) for i in t2["items"]] == [
        ("Romanian Deadlift", 4)
    ]
    t3 = ok(
        client.put(
            f"{API}/templates/{t['id']}",
            headers=h,
            json={
                "name": "Legs B3",
                "items": [{"exercise_id": a}, {"exercise_id": b}, {"exercise_id": c}],
            },
        )
    )
    assert [i["exercise_name"] for i in t3["items"]] == [
        "Back Squat",
        "Leg Press",
        "Romanian Deadlift",
    ]
    err(
        client.put(
            f"{API}/templates/{t['id']}",
            headers=h,
            json={"name": "x", "items": [{"exercise_id": str(uuid.uuid4())}]},
        ),
        404,
        "exercise_not_found",
    )
    ok(client.delete(f"{API}/templates/{t['id']}", headers=h))
    err(client.get(f"{API}/templates/{t['id']}", headers=h), 404, "template_not_found")
    back = ok(client.post(f"{API}/templates/{t['id']}/restore", headers=h))
    assert len(back["items"]) == 3
    wid = finished_workout(
        user,
        started_at=utcnow() - timedelta(days=1),
        lifts=[(uuid.UUID(a), [(5, 100), (5, 100)])],
        name="Heavy",
    )
    copy = ok(client.post(f"{API}/workouts/{wid}/save-as-template", headers=h, json={}))
    assert copy["name"] == "Heavy (copy)" and [
        (i["exercise_name"], i["sets"]) for i in copy["items"]
    ] == [("Back Squat", 2)]


def test_settings_update_and_validation(client: TestClient, db: Session) -> None:
    _, h = signed_in(db)
    st = ok(
        client.patch(
            f"{API}/settings",
            headers=h,
            json={
                "units": "lb",
                "weekly_target": 3,
                "goal_direction": "bulk",
                "goal_weight": 80,
            },
        )
    )
    assert (st["units"], st["weekly_target"], st["goal_direction"]) == ("lb", 3, "bulk")
    assert (
        client.patch(f"{API}/settings", headers=h, json={"rest_sec": 901}).status_code
        == 422
    )
    assert (
        client.patch(f"{API}/settings", headers=h, json={"units": "st"}).status_code
        == 422
    )


def test_overview_and_stats(client: TestClient, db: Session) -> None:
    user, h = signed_in(db)
    ids = exercise_ids(client, h)
    templates = ok(client.get(f"{API}/templates", headers=h))["data"]
    push = templates[0]
    finished_workout(
        user,
        started_at=utcnow() - timedelta(days=1),
        lifts=[(uuid.UUID(ids["Barbell Bench Press"]), [(8, 60)])],
        template_id=uuid.UUID(push["id"]),
    )
    ok(client.post(f"{API}/weigh-ins", headers=h, json={"weight_kg": 80}))
    ov = ok(client.get(f"{API}/overview", headers=h))
    assert ov["next_template"]["name"] == "Pull A"
    assert ov["last_workout"]["totals"]["volume"] == 480
    assert ov["weighed_today"] is True and ov["macros_left"] is None
    assert ov["active"] is None and ov["weekly_target"] == 4
    st = ok(client.get(f"{API}/stats?days=30", headers=h))
    assert (
        st["period"]["sessions"] == 1
        and st["top_lifts"][0]["name"] == "Barbell Bench Press"
    )
    assert len(st["weeks"]) == 5 and len(st["weight_trend"]) == 30
    assert client.get(f"{API}/stats?days=0", headers=h).status_code == 422


def test_start_fresh_and_reset_keep_the_shared_catalog(
    client: TestClient, db: Session
) -> None:
    user, h = signed_in(db)
    templates_before = ok(client.get(f"{API}/templates", headers=h))["count"]
    exercises_before = ok(client.get(f"{API}/exercises", headers=h))["count"]
    ids = exercise_ids(client, h)
    finished_workout(
        user,
        started_at=utcnow() - timedelta(days=1),
        lifts=[(uuid.UUID(ids["Back Squat"]), [(5, 100)])],
    )
    ok(client.post(f"{API}/weigh-ins", headers=h, json={"weight_kg": 80}))
    ok(
        client.put(
            f"{API}/targets",
            headers=h,
            json={"kcal": 2000, "protein": 150, "carbs": 200, "fat": 60},
        )
    )
    ok(client.post(f"{API}/workouts/start", headers=h, json={}))
    fresh = ok(client.post(f"{API}/start-fresh", headers=h))
    assert fresh["removed"] > 0
    assert ok(client.get(f"{API}/workouts", headers=h))["count"] == 0
    # Routines and exercises are every member's: starting over keeps them.
    assert ok(client.get(f"{API}/templates", headers=h))["count"] == templates_before
    assert ok(client.get(f"{API}/weigh-ins", headers=h))["count"] == 0
    assert ok(client.get(f"{API}/targets", headers=h))["current"] is not None
    assert ok(client.get(f"{API}/exercises", headers=h))["count"] == exercises_before
    with ctx_for(user) as ctx:
        assert profile_public.get_live(ctx) is None
    ok(client.patch(f"{API}/settings", headers=h, json={"weekly_target": 2}))
    custom = f"Custom {uuid.uuid4().hex[:6]}"
    ok(client.post(f"{API}/exercises", headers=h, json={"name": custom}))
    ok(client.post(f"{API}/reset", headers=h))
    assert ok(client.get(f"{API}/settings", headers=h))["weekly_target"] == 4
    assert ok(client.get(f"{API}/targets", headers=h))["current"] is None
    assert ok(client.get(f"{API}/exercises?q={custom}", headers=h))["count"] == 1
    names = [t["name"] for t in ok(client.get(f"{API}/templates", headers=h))["data"]]
    assert {"Push A", "Pull A", "Legs A"} <= set(names)


def test_members_share_routines_and_exercises_but_edit_only_their_own(
    client: TestClient, db: Session
) -> None:
    _, h1 = signed_in(db)
    _, h2 = signed_in(db)
    ex = ok(
        client.post(
            f"{API}/exercises",
            headers=h1,
            json={"name": f"Sled push {uuid.uuid4().hex[:6]}"},
        )
    )
    t = ok(
        client.post(
            f"{API}/templates",
            headers=h1,
            json={
                "name": f"Sled day {uuid.uuid4().hex[:6]}",
                "items": [{"exercise_id": ex["id"]}],
            },
        )
    )
    # The second member reads and uses both...
    assert ok(client.get(f"{API}/templates/{t['id']}", headers=h2))["name"] == t["name"]
    assert (
        ok(client.get(f"{API}/exercises/{ex['id']}", headers=h2))["name"] == ex["name"]
    )
    started = ok(
        client.post(
            f"{API}/workouts/start",
            headers=h2,
            json={"source": "template", "template_id": t["id"]},
        )
    )
    assert started["exercises"][0]["exercise_id"] == ex["id"]
    ok(client.post(f"{API}/workouts/{started['id']}/discard", headers=h2))
    ok(
        client.post(
            f"{API}/templates",
            headers=h2,
            json={
                "name": f"Mine {uuid.uuid4().hex[:6]}",
                "items": [{"exercise_id": ex["id"]}],
            },
        )
    )
    # ...but cannot change, archive or delete what the first one added.
    body = {"name": "Renamed", "equipment": "barbell", "muscle": "chest"}
    err(
        client.put(f"{API}/exercises/{ex['id']}", headers=h2, json=body),
        403,
        "catalog_read_only",
    )
    err(
        client.post(
            f"{API}/exercises/{ex['id']}/archive", headers=h2, json={"archived": True}
        ),
        403,
        "catalog_read_only",
    )
    err(
        client.put(
            f"{API}/templates/{t['id']}",
            headers=h2,
            json={"name": "Renamed", "items": [{"exercise_id": ex["id"]}]},
        ),
        403,
        "catalog_read_only",
    )
    err(
        client.delete(f"{API}/templates/{t['id']}", headers=h2),
        403,
        "catalog_read_only",
    )
    assert (
        ok(client.get(f"{API}/exercises/{ex['id']}", headers=h1))["name"] == ex["name"]
    )


def test_settings_plan_profile_round_trip_and_validation(
    client: TestClient, db: Session
) -> None:
    _, h = signed_in(db)
    body = {
        "sex": "female",
        "birth_year": 1996,
        "height_cm": 165,
        "activity_level": "light",
        "plan_goal": "recomp",
    }
    st = ok(client.patch(f"{API}/settings", headers=h, json=body))
    assert {k: st[k] for k in body} == body
    assert st["goal_direction"] == "maintain"  # untouched; client writes both
    for bad in (
        {"height_cm": 99},
        {"height_cm": 251},
        {"birth_year": 1899},
        {"birth_year": utcnow().year - 12},
        {"sex": "x"},
        {"activity_level": "extreme"},
        {"plan_goal": "bulk"},
    ):
        assert client.patch(f"{API}/settings", headers=h, json=bad).status_code == 422
