"""Workouts end to end: the three ways to start, one active workout, the
Live bar, editing sets and exercises, finish/discard/delete/restore."""

import uuid
from datetime import timedelta
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session

from app.modules.fitness.models import Workout
from app.modules.profile import public as profile_public
from app.shared import owned_repo
from app.shared.owned import utcnow
from tests.modules.fitness.api.helpers import (
    API,
    err,
    exercise_ids,
    finished_workout,
    ok,
)
from tests.utils.mobile import ctx_for, signed_in
from tests.utils.user import create_auth_user
from tests.utils.utils import auth_headers

STUB = pytest.mark.xfail(
    raises=NotImplementedError,
    strict=False,
    reason="habits.public.auto_check_workout_habits is a stub until merge",
)


def _start(client: TestClient, h: dict[str, str], **body: object) -> dict[str, Any]:
    return ok(client.post(f"{API}/workouts/start", headers=h, json=body))  # type: ignore[no-any-return]


def test_empty_start_claims_the_live_bar_and_resumes(
    client: TestClient, db: Session
) -> None:
    user, h = signed_in(db)
    first = _start(client, h)
    w = first["workout"]
    assert first["resumed"] is False
    assert w["status"] == "in_progress" and w["exercises"] == []
    assert w["name"].endswith("workout")
    with ctx_for(user) as ctx:
        live = profile_public.get_live(ctx)
        assert live is not None and live.kind == "workout"
        assert str(live.ref_id) == w["id"]
        assert live.label == f"{w['name']} · 0/0 sets"
    # A second start returns the workout already in progress.
    again = _start(client, h, source="template", template_id=str(uuid.uuid4()))
    assert again["resumed"] is True and again["workout"]["id"] == w["id"]
    active = ok(client.get(f"{API}/workouts/active", headers=h))
    assert active["id"] == w["id"]


def test_template_start_plans_sets_from_history(
    client: TestClient, db: Session
) -> None:
    user, h = signed_in(db)
    ids = exercise_ids(client, h)
    bench = uuid.UUID(ids["Barbell Bench Press"])
    # Last bench session: every set at the top of the 6-10 range -> +2.5 kg.
    finished_workout(
        user,
        started_at=utcnow() - timedelta(days=3),
        lifts=[(bench, [(10, 60), (10, 60), (10, 60)])],
    )
    templates = ok(client.get(f"{API}/templates", headers=h))["data"]
    push = next(t for t in templates if t["name"] == "Push A")
    w = _start(client, h, source="template", template_id=push["id"])["workout"]
    assert w["name"] == "Push A" and w["template_id"] == push["id"]
    assert [e["exercise_name"] for e in w["exercises"]] == [
        "Barbell Bench Press",
        "Overhead Press",
        "Incline Dumbbell Press",
        "Lateral Raise",
        "Triceps Pushdown",
    ]
    bench_sets = w["exercises"][0]["sets"]
    assert [(s["reps"], s["weight"], s["kind"]) for s in bench_sets] == [
        (6, 62.5, "working")
    ] * 3
    # A lift never done gets one blank set at the bottom of its range.
    ohp_sets = w["exercises"][1]["sets"]
    assert [(s["reps"], s["weight"]) for s in ohp_sets] == [(6, 0)]
    assert all(s["completed_at"] is None for e in w["exercises"] for s in e["sets"])


def test_repeat_start_copies_the_workout(client: TestClient, db: Session) -> None:
    user, h = signed_in(db)
    ids = exercise_ids(client, h)
    squat, rdl = uuid.UUID(ids["Back Squat"]), uuid.UUID(ids["Romanian Deadlift"])
    src = finished_workout(
        user,
        started_at=utcnow() - timedelta(days=2),
        lifts=[
            (squat, [(5, 80), (5, 80)]),
            (rdl, [(7, 70), (6, 70), (6, 70), (6, 70)]),
        ],
        name="Legs day",
    )
    w = _start(client, h, source="repeat", workout_id=str(src))["workout"]
    assert w["name"] == "Legs day"
    counts = [len(e["sets"]) for e in w["exercises"]]
    assert counts == [2, 4]
    # Squat 5/5 under the 5-8 range max: hold weight, aim one more rep.
    assert {(s["reps"], s["weight"]) for s in w["exercises"][0]["sets"]} == {(6, 80)}


def test_start_requires_its_source(client: TestClient, db: Session) -> None:
    _, h = signed_in(db)
    err(
        client.post(f"{API}/workouts/start", headers=h, json={"source": "template"}),
        422,
        "template_required",
    )
    err(
        client.post(f"{API}/workouts/start", headers=h, json={"source": "repeat"}),
        422,
        "workout_required",
    )
    err(
        client.post(
            f"{API}/workouts/start",
            headers=h,
            json={"source": "template", "template_id": str(uuid.uuid4())},
        ),
        404,
        "template_not_found",
    )


def test_live_bar_conflict_refuses_and_writes_nothing(
    client: TestClient, db: Session
) -> None:
    user, h = signed_in(db)
    with ctx_for(user) as ctx:
        profile_public.start_live(
            ctx, kind="timer", label="Meditate", href="/habits/x", ref_id=uuid.uuid4()
        )
        ctx.session.commit()
    r = client.post(f"{API}/workouts/start", headers=h, json={})
    err(r, 409, "live_session_busy")
    assert r.json()["details"]["label"] == "Meditate"
    assert ok(client.get(f"{API}/workouts/active", headers=h)) is None


def test_one_active_workout_is_a_database_wall(client: TestClient, db: Session) -> None:
    user, h = signed_in(db)
    _start(client, h)
    with ctx_for(user) as ctx:
        with pytest.raises(IntegrityError):
            owned_repo.insert(
                ctx,
                Workout,
                {"name": "Second", "started_at": ctx.now, "status": "in_progress"},
            )
        ctx.session.rollback()


def test_losing_the_start_race_is_a_409(client: TestClient, db: Session) -> None:
    """Two devices pass the "nothing active" check together; the second
    insert trips the partial unique index and becomes a 409."""
    from app.modules.fitness import services

    user, h = signed_in(db)
    _start(client, h)
    with ctx_for(user) as ctx:
        with pytest.raises(Exception) as exc:
            services._insert_active(ctx, uuid.uuid4(), name="Race", template_id=None)
        assert getattr(exc.value, "status_code", None) == 409
        assert exc.value.detail["code"] == "workout_in_progress"  # type: ignore[attr-defined]


def test_editing_sets_and_exercises(client: TestClient, db: Session) -> None:
    _, h = signed_in(db)
    ids = exercise_ids(client, h)
    w = _start(client, h)["workout"]
    wid = w["id"]
    added = ok(
        client.post(
            f"{API}/workouts/{wid}/exercises",
            headers=h,
            json={
                "exercise_ids": [
                    ids["Barbell Row"],
                    ids["Lat Pulldown"],
                    ids["Dumbbell Curl"],
                ]
            },
        )
    )
    row, pull, curl = (e["id"] for e in added["exercises"])
    # Toggle: completes the set and starts the default rest (120 s).
    s0 = added["exercises"][0]["sets"][0]["id"]
    t = ok(
        client.post(f"{API}/workouts/{wid}/exercises/{row}/sets/{s0}/toggle", headers=h)
    )
    assert t["completed"] is True and t["set"]["completed_at"] is not None
    assert t["rest"]["duration_sec"] == 120
    untick = ok(
        client.post(f"{API}/workouts/{wid}/exercises/{row}/sets/{s0}/toggle", headers=h)
    )
    assert untick["completed"] is False and untick["rest"] is None
    # Update, add (copies the last working set), remove.
    upd = ok(
        client.patch(
            f"{API}/workouts/{wid}/exercises/{row}/sets/{s0}",
            headers=h,
            json={"reps": 9, "weight": 52.5, "kind": "drop"},
        )
    )
    assert (upd["reps"], upd["weight"], upd["kind"]) == (9, 52.5, "drop")
    new = ok(
        client.post(f"{API}/workouts/{wid}/exercises/{row}/sets", headers=h, json={})
    )
    assert (new["reps"], new["weight"], new["kind"]) == (9, 52.5, "working")
    ok(
        client.delete(
            f"{API}/workouts/{wid}/exercises/{row}/sets/{new['id']}", headers=h
        )
    )
    # Move: curl up one, then a move past the top is a no-op.
    order = ok(
        client.post(
            f"{API}/workouts/{wid}/exercises/{curl}/move", headers=h, json={"dir": -1}
        )
    )
    assert [e["id"] for e in order] == [row, curl, pull]
    order = ok(
        client.post(
            f"{API}/workouts/{wid}/exercises/{row}/move", headers=h, json={"dir": -1}
        )
    )
    assert [e["id"] for e in order] == [row, curl, pull]
    # Replace re-plans the sets; note; remove.
    rep = ok(
        client.post(
            f"{API}/workouts/{wid}/exercises/{pull}/replace",
            headers=h,
            json={"exercise_id": ids["Face Pull"]},
        )
    )
    replaced = next(e for e in rep["exercises"] if e["id"] == pull)
    assert replaced["exercise_name"] == "Face Pull" and len(replaced["sets"]) == 1
    note = ok(
        client.patch(
            f"{API}/workouts/{wid}/exercises/{curl}",
            headers=h,
            json={"note": "slow eccentric"},
        )
    )
    assert note["note"] == "slow eccentric"
    ok(client.delete(f"{API}/workouts/{wid}/exercises/{curl}", headers=h))
    meta = ok(
        client.patch(
            f"{API}/workouts/{wid}", headers=h, json={"name": "Pull B", "notes": "ok"}
        )
    )
    assert meta["name"] == "Pull B" and [e["id"] for e in meta["exercises"]] == [
        row,
        pull,
    ]
    # Move after a removal still works (the removed row keeps its slot).
    order = ok(
        client.post(
            f"{API}/workouts/{wid}/exercises/{pull}/move", headers=h, json={"dir": -1}
        )
    )
    assert [e["id"] for e in order] == [pull, row]


def test_set_of_another_exercise_is_not_found(client: TestClient, db: Session) -> None:
    _, h = signed_in(db)
    ids = exercise_ids(client, h)
    wid = _start(client, h)["workout"]["id"]
    w = ok(
        client.post(
            f"{API}/workouts/{wid}/exercises",
            headers=h,
            json={"exercise_ids": [ids["Barbell Row"], ids["Lat Pulldown"]]},
        )
    )
    a, b = w["exercises"]
    s_of_b = b["sets"][0]["id"]
    err(
        client.post(
            f"{API}/workouts/{wid}/exercises/{a['id']}/sets/{s_of_b}/toggle", headers=h
        ),
        404,
        "workout_set_not_found",
    )
    err(
        client.delete(f"{API}/workouts/{uuid.uuid4()}/exercises/{a['id']}", headers=h),
        404,
        "workout_not_found",
    )


@STUB
def test_finish_removes_unchecked_sets_and_releases_the_live_bar(
    client: TestClient, db: Session
) -> None:
    user, h = signed_in(db)
    ids = exercise_ids(client, h)
    wid = _start(client, h)["workout"]["id"]
    w = ok(
        client.post(
            f"{API}/workouts/{wid}/exercises",
            headers=h,
            json={"exercise_ids": [ids["Barbell Row"]]},
        )
    )
    we = w["exercises"][0]
    ok(
        client.post(
            f"{API}/workouts/{wid}/exercises/{we['id']}/sets", headers=h, json={}
        )
    )
    ok(
        client.post(
            f"{API}/workouts/{wid}/exercises/{we['id']}/sets/{we['sets'][0]['id']}/toggle",
            headers=h,
        )
    )
    done = ok(
        client.post(
            f"{API}/workouts/{wid}/finish", headers=h, json={"unfinished": "remove"}
        )
    )
    assert done["status"] == "finished" and done["ended_at"] is not None
    assert len(done["exercises"][0]["sets"]) == 1
    with ctx_for(user) as ctx:
        assert profile_public.get_live(ctx) is None
    assert ok(client.get(f"{API}/rest", headers=h)) is None


def test_finish_refuses_an_end_before_the_start(
    client: TestClient, db: Session
) -> None:
    _, h = signed_in(db)
    w = _start(client, h)["workout"]
    err(
        client.post(
            f"{API}/workouts/{w['id']}/finish",
            headers=h,
            json={"end_at": "2020-01-01T00:00:00Z"},
        ),
        422,
        "end_before_start",
    )


def test_discard_releases_and_hides(client: TestClient, db: Session) -> None:
    user, h = signed_in(db)
    wid = _start(client, h)["workout"]["id"]
    ok(client.post(f"{API}/workouts/{wid}/discard", headers=h))
    err(client.get(f"{API}/workouts/{wid}", headers=h), 404, "workout_not_found")
    err(
        client.post(f"{API}/workouts/{wid}/restore", headers=h),
        409,
        "workout_not_restorable",
    )
    with ctx_for(user) as ctx:
        assert profile_public.get_live(ctx) is None
    # A new workout can start straight away.
    assert _start(client, h)["resumed"] is False


def test_delete_and_restore_a_finished_workout(client: TestClient, db: Session) -> None:
    user, h = signed_in(db)
    ids = exercise_ids(client, h)
    wid = finished_workout(
        user,
        started_at=utcnow() - timedelta(days=1),
        lifts=[(uuid.UUID(ids["Back Squat"]), [(5, 100)])],
    )
    listed = ok(client.get(f"{API}/workouts", headers=h))
    assert [w["id"] for w in listed["data"]] == [str(wid)] and listed["count"] == 1
    ok(client.delete(f"{API}/workouts/{wid}", headers=h))
    assert ok(client.get(f"{API}/workouts", headers=h))["count"] == 0
    back = ok(client.post(f"{API}/workouts/{wid}/restore", headers=h))
    assert back["status"] == "finished"
    assert ok(client.get(f"{API}/workouts", headers=h))["count"] == 1


def test_history_filters_and_pagination(client: TestClient, db: Session) -> None:
    user, h = signed_in(db)
    ids = exercise_ids(client, h)
    squat, bench = uuid.UUID(ids["Back Squat"]), uuid.UUID(ids["Barbell Bench Press"])
    for i in range(5):
        finished_workout(
            user,
            started_at=utcnow() - timedelta(days=10 - i),
            lifts=[(squat if i % 2 else bench, [(5, 60 + i)])],
            name=f"W{i}",
        )
    page = ok(client.get(f"{API}/workouts?skip=1&limit=2", headers=h))
    assert page["count"] == 5 and [w["name"] for w in page["data"]] == ["W3", "W2"]
    assert (
        ok(client.get(f"{API}/workouts?exercise_id={squat}", headers=h))["count"] == 2
    )
    assert ok(client.get(f"{API}/workouts?q=bench", headers=h))["count"] == 3
    assert ok(client.get(f"{API}/workouts?limit=0", headers=h))["data"] == []
    assert client.get(f"{API}/workouts?limit=101", headers=h).status_code == 422
    assert client.get(f"{API}/workouts?skip=-1", headers=h).status_code == 422
    # Later sessions beat the first one: the history carries PR counts.
    assert (
        sum(w["pr_count"] for w in ok(client.get(f"{API}/workouts", headers=h))["data"])
        > 0
    )


def test_another_user_cannot_see_or_change_a_workout(
    client: TestClient, db: Session
) -> None:
    _, h1 = signed_in(db)
    _, h2 = signed_in(db)
    wid = _start(client, h1)["workout"]["id"]
    err(client.get(f"{API}/workouts/{wid}", headers=h2), 404, "workout_not_found")
    err(
        client.patch(f"{API}/workouts/{wid}", headers=h2, json={"name": "x"}),
        404,
        "workout_not_found",
    )
    err(
        client.post(f"{API}/workouts/{wid}/discard", headers=h2),
        404,
        "workout_not_found",
    )
    assert ok(client.get(f"{API}/workouts/active", headers=h2)) is None


def test_role_less_user_is_refused(client: TestClient, db: Session) -> None:
    user, password = create_auth_user(db, assign_default_role=False)
    h = auth_headers(user.email, password)
    assert client.get(f"{API}/workouts", headers=h).status_code == 403
    assert client.post(f"{API}/workouts/start", headers=h, json={}).status_code == 403


def test_validation_is_422(client: TestClient, db: Session) -> None:
    _, h = signed_in(db)
    wid = _start(client, h)["workout"]["id"]
    assert (
        client.post(
            f"{API}/workouts/start", headers=h, json={"source": "nope"}
        ).status_code
        == 422
    )
    assert (
        client.patch(f"{API}/workouts/{wid}", headers=h, json={"name": ""}).status_code
        == 422
    )
    assert (
        client.post(
            f"{API}/workouts/{wid}/exercises", headers=h, json={"exercise_ids": []}
        ).status_code
        == 422
    )


def test_rest_timer_start_adjust_skip(client: TestClient, db: Session) -> None:
    _, h = signed_in(db)
    assert ok(client.get(f"{API}/rest", headers=h)) is None
    r = ok(client.post(f"{API}/rest/start", headers=h, json={"sec": 90}))
    assert r["duration_sec"] == 90
    a = ok(client.post(f"{API}/rest/adjust", headers=h, json={"delta": -15}))
    assert a["duration_sec"] == 75
    assert a["ends_at"] < r["ends_at"]
    floor = ok(client.post(f"{API}/rest/adjust", headers=h, json={"delta": -900}))
    assert floor["duration_sec"] == 0
    ok(client.post(f"{API}/rest/skip", headers=h))
    assert ok(client.get(f"{API}/rest", headers=h)) is None
    assert ok(client.post(f"{API}/rest/adjust", headers=h, json={"delta": 15})) is None
    # Restart revives the one row.
    assert (
        ok(client.post(f"{API}/rest/start", headers=h, json={}))["duration_sec"] == 120
    )


def test_share_card(client: TestClient, db: Session) -> None:
    user, h = signed_in(db)
    ids = exercise_ids(client, h)
    bench = uuid.UUID(ids["Barbell Bench Press"])
    finished_workout(
        user, started_at=utcnow() - timedelta(days=5), lifts=[(bench, [(8, 60)])]
    )
    wid = finished_workout(
        user,
        started_at=utcnow() - timedelta(days=1),
        lifts=[(bench, [(8, 65), (6, 65)])],
    )
    card = ok(client.get(f"{API}/workouts/{wid}/share-card", headers=h))
    assert card["totals"]["volume"] == 8 * 65 + 6 * 65
    assert card["totals"]["done"] == 2
    assert [p["kind"] for p in card["prs"]] == ["e1rm"]
    assert card["focus_exercise_id"] == str(bench)
    assert card["series"] == [60 * (1 + 8 / 30), 65 * (1 + 8 / 30)]
    assert card["lines"][0]["top_reps"] == 8 and card["lines"][0]["top_weight"] == 65
