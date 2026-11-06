"""The finer primary muscles (delts, lats, traps, abductors, adductors…):
every list agrees, the API stores and filters them, and the revision that
added them folds them back into their broad group on downgrade."""

import subprocess
import sys
from pathlib import Path
from typing import get_args

from fastapi.testclient import TestClient
from pydantic import TypeAdapter
from sqlalchemy import text
from sqlmodel import Session

from app.core.db import engine
from app.modules.capture import fitness_tools
from app.modules.fitness import models, schema
from tests.modules.fitness.api.helpers import API, ok
from tests.utils.mobile import signed_in

REVISION = "e5b2c8a41d07"
PREVIOUS = "b26722602ce5"
BACKEND = Path(__file__).resolve().parents[4]
# Written out by hand, not read from the module: these are the stored values
# the mobile client and Fern rely on.
BROAD = {
    "chest", "back", "shoulders", "biceps", "triceps", "quads",
    "hamstrings", "glutes", "core", "cardio", "calves", "forearms",
}  # fmt: skip
FINER = {
    "upper_chest": "chest",
    "front_delts": "shoulders",
    "side_delts": "shoulders",
    "rear_delts": "shoulders",
    "lats": "back",
    "traps": "back",
    "rhomboids": "back",
    "lower_back": "back",
    "obliques": "core",
    "abductors": "glutes",
    "adductors": "quads",
    "tibialis": "calves",
    "hip_flexors": "quads",
    "neck": "back",
}


def test_every_muscle_list_is_the_same_and_keeps_the_old_values() -> None:
    want = BROAD | set(FINER)
    assert set(models.MUSCLES) == want
    assert set(get_args(schema.Muscle)) == want
    # Fern's tools offer the fitness module's list and accept each value.
    fern = TypeAdapter(fitness_tools.Muscle)
    assert set(fern.json_schema()["enum"]) == want
    assert all(fern.validate_python(m) == m for m in want)
    # The column is String(12).
    assert max(len(m) for m in want) <= 12


def test_each_new_muscle_saves_and_filters(client: TestClient, db: Session) -> None:
    _, h = signed_in(db)
    for m in FINER:
        body = {"name": f"Lift {m}", "equipment": "machine", "muscle": m}
        assert ok(client.post(f"{API}/exercises", headers=h, json=body))["muscle"] == m
    listed = ok(client.get(f"{API}/exercises?muscle=abductors", headers=h))
    assert [e["name"] for e in listed["data"]] == ["Lift abductors"]
    bad = client.post(
        f"{API}/exercises",
        headers=h,
        json={"name": "Nope", "equipment": "machine", "muscle": "abs"},
    )
    assert bad.status_code == 422


def _alembic(*args: str) -> None:
    engine.dispose()  # no pooled connection may hold a lock the DDL waits on
    subprocess.run([sys.executable, "-m", "alembic", *args], cwd=BACKEND, check=True)


def _muscles(owner: object) -> dict[str, str]:
    with Session(engine) as s:
        rows = s.execute(
            text("SELECT name, muscle FROM exercise WHERE owner_id = :o"),
            {"o": owner},
        ).all()
    return {r[0]: r[1] for r in rows}


def test_downgrade_folds_finer_muscles_into_their_group(
    client: TestClient, db: Session
) -> None:
    user, h = signed_in(db)
    for m in FINER:
        body = {"name": f"Fold {m}", "equipment": "cable", "muscle": m}
        ok(client.post(f"{API}/exercises", headers=h, json=body))
    try:
        _alembic("downgrade", PREVIOUS)
        folded = _muscles(user.id)
        assert {m: folded[f"Fold {m}"] for m in FINER} == FINER
    finally:
        _alembic("upgrade", REVISION)
    # Back up, the old values still save.
    body = {"name": "Fold calves again", "equipment": "cable", "muscle": "calves"}
    ok(client.post(f"{API}/exercises", headers=h, json=body))
