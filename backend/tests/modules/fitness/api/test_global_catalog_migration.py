"""The built-in/own catalog revision: which shared rows turn built in, which
turn private, the deletions other members' phones receive, and a clean
downgrade and re-upgrade."""

import subprocess
import sys
import uuid
from datetime import timedelta
from pathlib import Path
from typing import Any

from fastapi.testclient import TestClient
from sqlalchemy import text
from sqlmodel import Session

from app.core.db import engine
from app.modules.fitness import services
from app.modules.fitness.models import Exercise, TemplateItem, WorkoutTemplate
from app.shared import owned_repo
from app.shared.ids import derived_id
from app.shared.owned import utcnow
from tests.modules.fitness.api.helpers import finished_workout
from tests.modules.fitness.api.test_sync_fitness import pull_all
from tests.utils.mobile import ctx_for, signed_in

REVISION = "0ebdc219ab8e"
PREVIOUS = "2f24e6183b14"
BACKEND = Path(__file__).resolve().parents[4]


def _alembic(db: Session, *args: str) -> None:
    # No open transaction may hold a lock the DDL waits on (dropping the
    # scope-exit table's foreign key locks "user").
    db.commit()
    engine.dispose()
    subprocess.run([sys.executable, "-m", "alembic", *args], cwd=BACKEND, check=True)


def _has_column() -> bool:
    with Session(engine) as s:
        return bool(
            s.exec(
                text(
                    "SELECT 1 FROM information_schema.columns"
                    " WHERE table_name = 'exercise' AND column_name = 'is_global'"
                )
            ).first()
        )


def _state(tenant: uuid.UUID) -> dict[str, Any]:
    with Session(engine) as s:
        rows = {
            table: {
                r[0]: (r[1], r[2])
                for r in s.exec(
                    text(
                        f"SELECT id, is_global, owner_id FROM {table}"
                        " WHERE tenant_id = :t"
                    ),
                    params={"t": tenant},
                )
            }
            for table in ("exercise", "workout_template", "template_item")
        }
        exits = {
            r[0]: r[1]
            for r in s.exec(
                text(
                    "SELECT row_id, owner_id FROM sync_scope_exit WHERE tenant_id = :t"
                ),
                params={"t": tenant},
            )
        }
    return {**rows, "exits": exits}


def test_upgrade_splits_built_in_from_own_and_downgrade_restores(
    client: TestClient, db: Session, own_tenant: uuid.UUID
) -> None:
    ua, ha = signed_in(db)
    ub, hb = signed_in(db)
    with ctx_for(ua) as ctx:
        services.get_settings(ctx=ctx)  # seeds the built-in library and split
        lib = {e.name: e.id for e in services.catalog_exercises(ctx)}

        def ex(name: str) -> uuid.UUID:
            return owned_repo.insert(
                ctx,
                Exercise,
                {"name": name, "equipment": "cable", "muscle": "back"},
            ).id

        def tpl(name: str, *ex_ids: uuid.UUID) -> uuid.UUID:
            t = owned_repo.insert(ctx, WorkoutTemplate, {"name": name})
            for pos, e in enumerate(ex_ids):
                owned_repo.insert(
                    ctx,
                    TemplateItem,
                    {"template_id": t.id, "exercise_id": e, "position": pos},
                )
            return t.id

        a_only = ex("A only")
        logged_by_b = ex("Logged by B")
        in_b_slot = ex("In B's slot")
        in_trained_routine = ex("In a routine B trained")
        mixed_slot = ex("Mixed slot")
        old_name = ex("Old name")
        private_day = tpl("Private day", a_only)
        trained_day = tpl("Trained day", in_trained_routine)
        mixed_day = tpl("Mixed day")
        ctx.session.commit()
    with ctx_for(ub) as ctx:
        b_day = owned_repo.insert(ctx, WorkoutTemplate, {"name": "B day"})
        owned_repo.insert(
            ctx,
            TemplateItem,
            {"template_id": b_day.id, "exercise_id": in_b_slot, "position": 0},
        )
        # An admin's edit of another member's routine left a slot owned by B.
        stray = owned_repo.insert(
            ctx,
            TemplateItem,
            {"template_id": mixed_day, "exercise_id": mixed_slot, "position": 0},
        )
        ctx.session.commit()
        b_day_id, stray_id = b_day.id, stray.id
    finished_workout(
        ub, started_at=utcnow() - timedelta(days=2), lifts=[(logged_by_b, [(8, 40)])]
    )
    finished_workout(
        ub,
        started_at=utcnow() - timedelta(days=1),
        lifts=[(lib["Back Squat"], [(5, 90)])],
        template_id=trained_day,
    )
    with Session(engine) as s:
        s.exec(
            text(
                "UPDATE exercise SET merged_into_id = :to, archived = true WHERE id = :id"
            ),
            params={"to": logged_by_b, "id": old_name},
        )
        s.commit()

    # The shared era: no built-ins, every row everyone's.
    _alembic(db, "downgrade", PREVIOUS)
    assert not _has_column()
    _alembic(db, "upgrade", REVISION)
    first = _state(own_tenant)
    # Later revisions back on before the API is used: the models expect the
    # whole schema, not this revision's.
    _alembic(db, "upgrade", "head")

    g = {k: v[0] for k, v in first["exercise"].items()}
    assert all(g[i] for i in lib.values())  # the seeded library
    assert g[logged_by_b] and g[in_b_slot] and g[in_trained_routine]
    assert g[old_name]  # merged into a built-in: resolvable by everyone
    assert not g[a_only] and not g[mixed_slot]
    t = {k: v[0] for k, v in first["workout_template"].items()}
    split = {
        derived_id("template", own_tenant, k) for k in ("push-a", "pull-a", "legs-a")
    }
    assert t[trained_day] and all(t[i] for i in split)
    assert set(t) == split | {private_day, trained_day, mixed_day, b_day_id}
    assert not t[private_day] and not t[mixed_day] and not t[b_day_id]
    items = first["template_item"]
    for item_id, (is_global, _) in items.items():
        with Session(engine) as s:
            parent = s.exec(
                text("SELECT template_id FROM template_item WHERE id = :i"),
                params={"i": item_id},
            ).one()[0]
        assert is_global == t[parent]
    assert items[stray_id][1] == ua.id  # passed to the routine's owner
    # Rows that turned private reach the other member's phone as deletions.
    private = {i for i, (gl, _) in first["exercise"].items() if not gl}
    assert private == {a_only, mixed_slot}
    assert private == set(first["exits"]) & set(first["exercise"])
    assert first["exits"][a_only] == ua.id and first["exits"][b_day_id] == ub.id
    assert not {i for i in first["exits"] if g.get(i)}
    b_pull = {c["id"]: c for c in pull_all(client, hb)}
    assert b_pull[str(a_only)]["deleted"] is True
    assert b_pull[str(private_day)]["deleted"] is True
    assert b_pull[str(logged_by_b)]["row"]["is_global"] is True
    a_pull = {c["id"]: c for c in pull_all(client, ha)}
    assert a_pull[str(a_only)]["deleted"] is False
    assert a_pull[str(a_only)]["row"]["is_global"] is False
    assert str(b_day_id) not in a_pull or a_pull[str(b_day_id)]["deleted"]

    _alembic(db, "downgrade", PREVIOUS)
    assert not _has_column()
    with Session(engine) as s:
        assert s.exec(text("SELECT to_regclass('sync_scope_exit')")).one()[0] is None
    _alembic(db, "upgrade", "head")
    again = _state(own_tenant)
    for table in ("exercise", "workout_template", "template_item"):
        assert again[table] == first[table], table
    assert set(again["exits"]) == set(first["exits"])
