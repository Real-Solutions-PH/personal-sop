"""The built-in/own foods revision: a food a bulk import made (``usda:``,
``off:``, ``philfct:``) turns built in, every other food turns private to its
author; the downgrade restores one live food per name and runs clean; a
deleted member passes on only the built-in foods filed under them."""

import subprocess
import sys
import uuid
from pathlib import Path
from typing import Any

from sqlalchemy import text
from sqlmodel import Session

from app.core.db import engine
from app.modules.fitness.models import FoodItem
from app.shared import owned_repo
from tests.utils.mobile import ctx_for, signed_in

REVISION = "4d6171529d45"
PREVIOUS = "b3f1d7a2c946"
BACKEND = Path(__file__).resolve().parents[4]


def _alembic(db: Session, *args: str) -> None:
    db.commit()
    engine.dispose()
    subprocess.run([sys.executable, "-m", "alembic", *args], cwd=BACKEND, check=True)


def _has_column() -> bool:
    with Session(engine) as s:
        return bool(
            s.exec(
                text(
                    "SELECT 1 FROM information_schema.columns"
                    " WHERE table_name = 'food_item' AND column_name = 'is_global'"
                )
            ).first()
        )


def _food(ctx: Any, name: str, **extra: Any) -> uuid.UUID:
    row = owned_repo.insert(
        ctx,
        FoodItem,
        {"name": name, "key": name.lower(), "kcal": 100, "source": "said"} | extra,
    )
    ctx.session.commit()
    return row.id


def _rows(tenant: uuid.UUID) -> dict[uuid.UUID, tuple[bool, uuid.UUID, bool]]:
    """id -> (is_global, owner_id, deleted)"""
    with Session(engine) as s:
        return {
            r[0]: (r[1], r[2], r[3] is not None)
            for r in s.exec(
                text(
                    "SELECT id, is_global, owner_id, deleted_at FROM food_item"
                    " WHERE tenant_id = :t"
                ),
                params={"t": tenant},
            )
        }


def test_bulk_imports_turn_built_in_the_rest_private_and_downgrade_runs_clean(
    db: Session, own_tenant: uuid.UUID
) -> None:
    ua, _ = signed_in(db)
    ub, _ = signed_in(db)
    t = uuid.uuid4().hex[:6]
    with ctx_for(ua) as ctx:
        usda = _food(ctx, f"rice {t}", source="usda", external_ref=f"usda:{t}")
        off = _food(ctx, f"milo {t}", source="off", external_ref=f"off:{t}")
        fct = _food(ctx, f"kangkong {t}", source="philfct", external_ref=f"philfct:{t}")
        gone = _food(ctx, f"kale {t}", source="usda", external_ref=f"usda:{t}k")
        label = _food(ctx, f"skyflakes {t}", source="label")
        notion = _food(
            ctx, f"adobo {t}", source="usda", external_ref=f"https://notion.so/{t}"
        )
    with ctx_for(ub) as ctx:
        said = _food(ctx, f"siomai {t}")
        recipe = _food(ctx, f"sinigang {t}", source="recipe")
        brand = _food(ctx, f"jollibee {t}", source="brand", external_ref=None)
    with Session(engine) as s:
        s.execute(
            text("UPDATE food_item SET deleted_at = now() WHERE id = :id"),
            {"id": gone},
        )
        s.commit()

    # The shared era: no built-ins, every food everyone's.
    _alembic(db, "downgrade", PREVIOUS)
    assert not _has_column()
    _alembic(db, "upgrade", REVISION)
    first = _rows(own_tenant)
    built_in = {i for i, (g, _, _) in first.items() if g}
    assert built_in == {usda, off, fct, gone}  # tombstones too
    assert {i for i, (g, _, _) in first.items() if not g} == {
        label,
        notion,  # a household row naming a database is not an import
        said,
        recipe,
        brand,
    }
    # Owners are unchanged: a private food stays its author's.
    assert first[said][1] == ub.id and first[label][1] == ua.id
    _alembic(db, "upgrade", "head")

    # Since then: an own food may share a built-in food's name, and two
    # members may each have one. The downgrade keeps one live food per
    # name: the built-in one, else the oldest.
    with ctx_for(ub) as ctx:
        own_rice = _food(ctx, f"rice {t}")
        own_label = _food(ctx, f"skyflakes {t}")
    with ctx_for(ua) as ctx:
        later = _food(ctx, f"siomai {t}")
    with Session(engine) as s:
        # ``later`` is newer than ``said``.
        s.execute(
            text(
                "UPDATE food_item SET created_at = created_at + interval '1 hour'"
                " WHERE id = :id"
            ),
            {"id": later},
        )
        s.commit()
    _alembic(db, "downgrade", PREVIOUS)
    assert not _has_column()
    down = _rows_without_global(own_tenant)
    assert down[own_rice] is True and down[usda] is False
    assert down[own_label] is True and down[label] is False
    assert down[later] is True and down[said] is False
    _alembic(db, "upgrade", "head")
    assert _has_column()


def _rows_without_global(tenant: uuid.UUID) -> dict[uuid.UUID, bool]:
    """id -> deleted (before the column exists)."""
    with Session(engine) as s:
        return {
            r[0]: r[1] is not None
            for r in s.exec(
                text("SELECT id, deleted_at FROM food_item WHERE tenant_id = :t"),
                params={"t": tenant},
            )
        }


def test_a_deleted_member_passes_on_only_built_in_foods(
    db: Session, own_tenant: uuid.UUID
) -> None:
    heir, _ = signed_in(db)
    heir.is_superuser = True
    db.add(heir)
    db.commit()
    leaver, _ = signed_in(db)
    t = uuid.uuid4().hex[:6]
    with ctx_for(leaver) as ctx:
        built_in = _food(ctx, f"rice {t}", source="usda", external_ref=f"usda:{t}")
        own = _food(ctx, f"siomai {t}")
    with Session(engine) as s:
        s.execute(
            text("UPDATE food_item SET is_global = true WHERE id = :id"),
            {"id": built_in},
        )
        s.execute(text('DELETE FROM "user" WHERE id = :id'), {"id": leaver.id})
        s.commit()
    rows = _rows(own_tenant)
    assert rows[built_in][1] == heir.id
    assert own not in rows
