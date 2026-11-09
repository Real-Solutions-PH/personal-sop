"""Merging one exercise into another: REST, the sync action, and the
alias-aware lookups that follow a merge."""

import uuid
from datetime import timedelta
from typing import Any

from fastapi.testclient import TestClient
from sqlmodel import Session, col, select

from app.core.db import engine
from app.modules.fitness import services
from app.modules.fitness.models import Exercise, TemplateItem, WorkoutExercise
from app.shared.owned import utcnow
from tests.modules.fitness.api.helpers import (
    API,
    err,
    exercise_ids,
    finished_workout,
    ok,
)
from tests.modules.fitness.api.test_sync_fitness import op, pull_all, push
from tests.utils.mobile import ctx_for, signed_in


def _create(client: TestClient, h: dict[str, str], name: str, **extra: Any) -> str:
    body = {"name": name, "equipment": "barbell", "muscle": "chest", **extra}
    return str(ok(client.post(f"{API}/exercises", headers=h, json=body))["id"])


def _merge(client: TestClient, h: dict[str, str], source: str, target: str) -> Any:
    return client.post(
        f"{API}/exercises/{source}/merge", headers=h, json={"target_id": target}
    )


def _row(ex_id: str) -> Exercise:
    with Session(engine) as s:
        row = s.get(Exercise, uuid.UUID(ex_id))
        assert row is not None
        return row


def _refs(model: Any, ex_id: str) -> set[uuid.UUID]:
    with Session(engine) as s:
        return set(
            s.exec(
                select(model.id).where(col(model.exercise_id) == uuid.UUID(ex_id))
            ).all()
        )


def _template_with(client: TestClient, h: dict[str, str], ex_id: str) -> None:
    ok(
        client.post(
            f"{API}/templates",
            headers=h,
            json={"name": "Day", "items": [{"exercise_id": ex_id, "sets": 3}]},
        )
    )


def test_merge_moves_history_and_templates(client: TestClient, db: Session) -> None:
    user, h = signed_in(db)
    ids = exercise_ids(client, h)
    target = ids["Barbell Bench Press"]
    source = _create(client, h, "Bench press")
    finished_workout(
        user,
        started_at=utcnow() - timedelta(days=3),
        lifts=[(uuid.UUID(source), [(5, 100)])],
    )
    finished_workout(
        user,
        started_at=utcnow() - timedelta(days=1),
        lifts=[(uuid.UUID(target), [(5, 90)])],
    )
    _template_with(client, h, source)
    moved_we = _refs(WorkoutExercise, source)
    moved_ti = _refs(TemplateItem, source)
    assert moved_we and moved_ti

    survivor = ok(_merge(client, h, source, target))

    assert survivor["id"] == target
    # A built-in target is never written: it gains no alias.
    assert survivor["aliases"] == [] and survivor["is_global"] is True
    assert moved_we <= _refs(WorkoutExercise, target)
    assert moved_ti <= _refs(TemplateItem, target)
    assert not _refs(WorkoutExercise, source) and not _refs(TemplateItem, source)
    gone = _row(source)
    assert gone.archived and gone.merged_into_id == uuid.UUID(target)
    detail = ok(client.get(f"{API}/exercises/{target}", headers=h))
    assert len(detail["history"]) == 2
    listed = ok(client.get(f"{API}/exercises?include_archived=true", headers=h))
    assert source not in {e["id"] for e in listed["data"]}
    found = ok(client.get(f"{API}/exercises?q=bench%20press", headers=h))
    assert [e["id"] for e in found["data"]] == [target]


def test_merge_refusals(client: TestClient, db: Session) -> None:
    _, h = signed_in(db)
    ids = exercise_ids(client, h)
    bench = ids["Barbell Bench Press"]
    a = _create(client, h, "Bench A")
    hold = _create(client, h, "Hold", load_type="time")
    err(_merge(client, h, a, hold), 422, "merge_load_type_mismatch")
    err(_merge(client, h, a, a), 422, "merge_same_exercise")
    # A built-in never merges away.
    err(_merge(client, h, bench, a), 403, "catalog_read_only")
    ok(_merge(client, h, a, bench))
    err(_merge(client, h, a, ids["Overhead Press"]), 422, "exercise_already_merged")
    c, d = _create(client, h, "Bench C"), _create(client, h, "Bench D")
    ok(_merge(client, h, c, d))
    err(_merge(client, h, d, c), 422, "merge_cycle")


def test_another_members_exercise_is_neither_source_nor_target(
    client: TestClient, db: Session
) -> None:
    _, ha = signed_in(db)
    _, hb = signed_in(db)
    theirs = _create(client, ha, f"Theirs {uuid.uuid4().hex[:6]}")
    mine_source = _create(client, hb, f"Mine {uuid.uuid4().hex[:6]}")
    before = _row(theirs)

    # Another member's own exercise is not there for me at all.
    err(_merge(client, hb, theirs, mine_source), 404, "exercise_not_found")
    err(_merge(client, hb, mine_source, theirs), 404, "exercise_not_found")
    after = _row(theirs)
    assert (after.archived, after.merged_into_id, after.version) == (
        before.archived,
        before.merged_into_id,
        before.version,
    )
    assert _row(mine_source).merged_into_id is None


def test_a_merge_moves_only_my_history(client: TestClient, db: Session) -> None:
    ua, ha = signed_in(db)
    ub, _ = signed_in(db)
    bench = exercise_ids(client, ha)["Barbell Bench Press"]
    source = _create(client, ha, f"Pec deck v{uuid.uuid4().hex[:6]}")
    wa = finished_workout(
        ua,
        started_at=utcnow() - timedelta(days=2),
        lifts=[(uuid.UUID(source), [(10, 40)])],
    )
    wb = finished_workout(
        ub,
        started_at=utcnow() - timedelta(days=1),
        lifts=[(uuid.UUID(bench), [(8, 45)])],
    )
    before = _row(bench)
    ok(_merge(client, ha, source, bench))
    with Session(engine) as s:
        moved = s.exec(
            select(WorkoutExercise).where(col(WorkoutExercise.workout_id).in_([wa, wb]))
        ).all()
    assert {(we.owner_id, str(we.exercise_id)) for we in moved} == {
        (ua.id, bench),
        (ub.id, bench),
    }
    after = _row(bench)
    assert (after.aliases, after.version) == (before.aliases, before.version)


def test_sync_action_is_idempotent(client: TestClient, db: Session) -> None:
    _, h = signed_in(db)
    target = exercise_ids(client, h)["Barbell Bench Press"]
    source = _create(client, h, "Flat bench")
    action = op("action", "fitness.merge_exercises", source_id=source, target_id=target)

    first = push(client, h, action)[0]
    version = _row(target).version
    second = push(client, h, {**action, "op_id": str(uuid.uuid4())})[0]

    assert first["status"] == "applied" and second["status"] == "applied"
    assert first["result"]["exercise"]["aliases"] == []  # built-in: untouched
    assert second["result"]["exercise"] == first["result"]["exercise"]
    assert _row(target).version == version


def test_chain_is_flattened(client: TestClient, db: Session) -> None:
    _, h = signed_in(db)
    b = _create(client, h, "Bench B")
    a = _create(client, h, "Bench A")
    c = _create(client, h, "Bench C")
    ok(_merge(client, h, c, a))
    survivor = ok(_merge(client, h, a, b))

    assert _row(c).merged_into_id == uuid.UUID(b)
    assert set(survivor["aliases"]) == {"Bench A", "Bench C"}


def test_chat_logging_finds_the_survivor(client: TestClient, db: Session) -> None:
    user, h = signed_in(db)
    target = exercise_ids(client, h)["Barbell Bench Press"]
    with ctx_for(user) as ctx:
        # A name the catalog does not resolve to the bench press yet.
        minted = services.find_or_create_exercise(ctx, "Flat bench")
        ctx.session.commit()
        source = str(minted.id)
    ok(_merge(client, h, source, target))

    with ctx_for(user) as ctx:
        again = str(services.find_or_create_exercise(ctx, "flat bench").id)
        replay = str(services.find_or_create_exercise(ctx, "FLAT BENCH ").id)
        ctx.session.commit()
    assert again == target and replay == target
    gone = _row(source)
    assert gone.archived and gone.merged_into_id == uuid.UUID(target)
    with Session(engine) as s:
        named = s.exec(
            select(Exercise).where(
                Exercise.owner_id == user.id,
                col(Exercise.name).ilike("flat bench"),
                col(Exercise.merged_into_id).is_(None),
            )
        ).all()
    assert named == []


def test_pull_carries_the_repointed_rows(client: TestClient, db: Session) -> None:
    user, h = signed_in(db)
    target = exercise_ids(client, h)["Barbell Bench Press"]
    source = _create(client, h, "Bench B")
    finished_workout(
        user,
        started_at=utcnow() - timedelta(days=2),
        lifts=[(uuid.UUID(source), [(5, 100)])],
    )
    _template_with(client, h, source)
    before = {c["id"]: c for c in pull_all(client, h)}

    ok(_merge(client, h, source, target))

    after = {c["id"]: c for c in pull_all(client, h)}
    for kind in ("workout_exercise", "template_item"):
        moved = [
            c
            for c in after.values()
            if c["entity"] == kind and c["row"]["exercise_id"] == target
        ]
        assert any(c["version"] > before[c["id"]]["version"] for c in moved), kind
    src = after[source]["row"]
    assert src["archived"] and src["merged_into_id"] == target


def test_merged_exercise_cannot_be_unarchived(client: TestClient, db: Session) -> None:
    _, h = signed_in(db)
    target = exercise_ids(client, h)["Barbell Bench Press"]
    source = _create(client, h, "Bench D")
    ok(_merge(client, h, source, target))

    refused = push(
        client, h, op("upsert", "exercise", source, name="Bench D", archived=False)
    )[0]
    assert (refused["status"], refused["code"]) == ("rejected", "exercise_merged")
    put = {"name": "Bench D", "equipment": "barbell", "muscle": "chest"}
    err(
        client.put(f"{API}/exercises/{source}", headers=h, json=put),
        422,
        "exercise_merged",
    )
    err(
        client.post(
            f"{API}/exercises/{source}/archive", headers=h, json={"archived": False}
        ),
        422,
        "exercise_merged",
    )
    row = _row(source)
    assert row.archived and row.merged_into_id == uuid.UUID(target)


def test_refused_merge_action_changes_nothing(client: TestClient, db: Session) -> None:
    user, h = signed_in(db)
    ids = exercise_ids(client, h)
    plank = ids["Plank"]
    source = _create(client, h, "Bench E")
    finished_workout(
        user,
        started_at=utcnow() - timedelta(days=2),
        lifts=[(uuid.UUID(source), [(5, 100)])],
    )
    _template_with(client, h, source)
    we, ti = _refs(WorkoutExercise, source), _refs(TemplateItem, source)
    before = (_row(source).version, _row(plank).version)

    res = push(
        client,
        h,
        op("action", "fitness.merge_exercises", source_id=source, target_id=plank),
    )[0]

    assert (res["status"], res["code"]) == ("rejected", "merge_load_type_mismatch")
    assert _refs(WorkoutExercise, source) == we and _refs(TemplateItem, source) == ti
    assert (_row(source).version, _row(plank).version) == before
    assert _row(source).merged_into_id is None and not _row(source).archived
