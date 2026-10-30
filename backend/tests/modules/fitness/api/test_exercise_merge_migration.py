"""The exercise-merge revision folds exact-name duplicates on upgrade and puts
every moved reference back on downgrade."""

import subprocess
import sys
import uuid
from datetime import timedelta
from pathlib import Path
from typing import Any

from sqlalchemy import text
from sqlmodel import Session

from app.core.db import engine
from app.modules.fitness.models import (
    Exercise,
    TemplateItem,
    WorkoutTemplate,
)
from app.shared import owned_repo
from app.shared.owned import utcnow
from tests.modules.fitness.api.helpers import finished_workout
from tests.utils.mobile import ctx_for, signed_in

REVISION = "efbedcc8af57"
PREVIOUS = "c4f2a8e61d07"
BACKEND = Path(__file__).resolve().parents[4]


def _alembic(*args: str) -> None:
    engine.dispose()  # no pooled connection may hold a lock the DDL waits on
    subprocess.run([sys.executable, "-m", "alembic", *args], cwd=BACKEND, check=True)


def _exercise(ctx: Any, name: str, load: str = "weight", **extra: Any) -> uuid.UUID:
    row = owned_repo.insert(
        ctx,
        Exercise,
        {
            "name": name,
            "equipment": "cable",
            "muscle": "back",
            "load_type": load,
            **extra,
        },
    )
    return row.id


def _state(owner: uuid.UUID) -> dict[str, Any]:
    with Session(engine) as s:
        refs = s.execute(
            text(
                "SELECT id, exercise_id FROM workout_exercise WHERE owner_id = :o"
                " UNION ALL SELECT id, exercise_id FROM template_item WHERE owner_id = :o"
            ),
            {"o": owner},
        ).all()
        cols = {
            r[0]
            for r in s.execute(
                text(
                    "SELECT column_name FROM information_schema.columns"
                    " WHERE table_name = 'exercise'"
                )
            )
        }
        merged = "merged_into_id" in cols
        ex = s.execute(
            text(
                "SELECT id, archived"
                + (", merged_into_id" if merged else ", NULL")
                + " FROM exercise WHERE owner_id = :o"
            ),
            {"o": owner},
        ).all()
        undo = s.execute(
            text("SELECT to_regclass('exercise_merge_undo') IS NOT NULL")
        ).scalar_one()
        undo_rows = (
            s.execute(
                text(
                    "SELECT table_name, row_id, old_exercise_id, old_archived"
                    " FROM exercise_merge_undo"
                )
            ).all()
            if undo
            else []
        )
    return {
        "refs": {r[0]: r[1] for r in refs},
        "exercises": {r[0]: (r[1], r[2]) for r in ex},
        "columns": merged,
        "undo_table": bool(undo),
        "undo": undo_rows,
    }


def test_upgrade_merges_exact_duplicates_and_downgrade_restores(db: Session) -> None:
    user, _ = signed_in(db)
    db.commit()
    with ctx_for(user) as ctx:
        keep = _exercise(ctx, "Lat Pulldown")
        lose = _exercise(ctx, "lat  pulldown ")
        lose2 = _exercise(ctx, "LAT PULLDOWN", archived=True)
        timed = _exercise(ctx, "Lat pulldown", load="time")
        gone = _exercise(ctx, "lat pulldown")
        owned_repo.soft_delete(ctx, owned_repo.require(ctx, Exercise, gone, what="x"))
        tpl = owned_repo.insert(ctx, WorkoutTemplate, {"name": "Pull"})
        owned_repo.insert(
            ctx,
            TemplateItem,
            {"template_id": tpl.id, "exercise_id": lose, "position": 0},
        )
        ctx.session.commit()
    start = utcnow() - timedelta(days=5)
    for d in range(2):
        finished_workout(
            user, started_at=start + timedelta(days=d), lifts=[(keep, [(8, 50)])]
        )
    finished_workout(
        user, started_at=start + timedelta(days=3), lifts=[(lose, [(8, 55)])]
    )
    finished_workout(
        user, started_at=start + timedelta(days=4), lifts=[(lose2, [(8, 60)])]
    )

    _alembic("downgrade", PREVIOUS)
    original = _state(user.id)
    assert not original["columns"] and not original["undo_table"]

    _alembic("upgrade", REVISION)
    merged = _state(user.id)
    moved = {rid for rid, ex in original["refs"].items() if ex in (lose, lose2)}
    assert len(moved) == 3
    for rid, ex in merged["refs"].items():
        assert ex == (keep if rid in moved else original["refs"][rid])
    assert merged["exercises"][lose] == (True, keep)
    assert merged["exercises"][lose2] == (True, keep)
    assert merged["exercises"][keep] == (False, None)
    assert merged["exercises"][timed] == (False, None)
    assert merged["exercises"][gone][1] is None
    mine = [u for u in merged["undo"] if u[1] in moved | {lose, lose2}]
    assert {u[1] for u in mine if u[0] != "exercise"} == moved
    assert {(u[1], u[3]) for u in mine if u[0] == "exercise"} == {
        (lose, False),
        (lose2, True),
    }

    _alembic("downgrade", PREVIOUS)
    restored = _state(user.id)
    assert restored == original

    _alembic("upgrade", "head")
    again = _state(user.id)
    assert again["refs"] == merged["refs"]
    assert again["exercises"] == merged["exercises"]
