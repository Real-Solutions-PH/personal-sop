"""Nutrition as its own module (ADR-0024).

Admits ``nutrition`` in the three module-key checks (widening
``daily_module_stat.module``, which held at most eight characters), gives
everyone who has a ``fitness`` preference a ``nutrition`` one with the same
switch and the default weight (meals were part of Fitness, so someone who had
turned Fitness off keeps meals off), and points goals on the two metrics that
moved at their new references. Meal, target and food tables are unchanged.

The backfilled preference id is the one the device mints for the same row
(``uuid5`` over ``module-pref:<user id>:nutrition``, ``app.shared.ids``), so
the phone's first push after updating lands on it instead of beside it.

Revision ID: e7b3d9a1c5f2
Revises: c4e9a1f7d352
Create Date: 2026-10-24

"""

import uuid

import sqlalchemy as sa
from alembic import op

revision = "e7b3d9a1c5f2"
down_revision = "c4e9a1f7d352"
branch_labels = None
depends_on = None

OLD_KEYS = ("habits", "tasks", "fitness", "finance")
NEW_KEYS = ("habits", "tasks", "fitness", "nutrition", "finance")
CHECKS = (
    ("module_pref", "ck_module_pref_module"),
    ("setup_skip", "ck_setup_skip_module"),
    ("daily_module_stat", "ck_daily_module_stat_module"),
)
MOVED = {
    "fitness:protein": "nutrition:protein",
    "fitness:calories": "nutrition:calories",
}
DEFAULT_WEIGHT = 2
# ``app.shared.ids.DERIVED_NAMESPACE``, copied so this revision never changes
# with the application code.
DERIVED_NAMESPACE = uuid.UUID("6f1d7c2a-4b8e-5a3c-9d10-2e7f40b1c9a5")


def _in(values: tuple[str, ...]) -> str:
    return "module IN (" + ", ".join(f"'{v}'" for v in values) + ")"


def _checks(values: tuple[str, ...]) -> None:
    for table, name in CHECKS:
        op.drop_constraint(name, table, type_="check")
        op.create_check_constraint(name, table, _in(values))


def upgrade() -> None:
    op.alter_column(
        "daily_module_stat",
        "module",
        type_=sa.String(length=16),
        existing_type=sa.String(length=8),
        existing_nullable=False,
    )
    _checks(NEW_KEYS)
    bind = op.get_bind()
    rows = bind.execute(
        sa.text(
            "SELECT owner_id, tenant_id, enabled FROM module_pref"
            " WHERE module = 'fitness' AND deleted_at IS NULL"
        )
    ).all()
    insert = sa.text(
        "INSERT INTO module_pref"
        " (id, owner_id, tenant_id, created_at, updated_at, module, enabled, weight)"
        " VALUES (:id, :owner, :tenant, now(), now(), 'nutrition', :enabled, :weight)"
        " ON CONFLICT ON CONSTRAINT uq_module_pref DO NOTHING"
    )
    for owner, tenant, enabled in rows:
        bind.execute(
            insert,
            {
                "id": uuid.uuid5(DERIVED_NAMESPACE, f"module-pref:{owner}:nutrition"),
                "owner": owner,
                "tenant": tenant,
                "enabled": enabled,
                "weight": DEFAULT_WEIGHT,
            },
        )
    for old, new in MOVED.items():
        bind.execute(
            sa.text("UPDATE goal SET metric = :new, updated_at = now() WHERE metric = :old"),
            {"old": old, "new": new},
        )


def downgrade() -> None:
    bind = op.get_bind()
    for old, new in MOVED.items():
        bind.execute(
            sa.text("UPDATE goal SET metric = :old, updated_at = now() WHERE metric = :new"),
            {"old": old, "new": new},
        )
    for table, _ in CHECKS:
        bind.execute(sa.text(f"DELETE FROM {table} WHERE module = 'nutrition'"))
    _checks(OLD_KEYS)
    op.alter_column(
        "daily_module_stat",
        "module",
        type_=sa.String(length=8),
        existing_type=sa.String(length=16),
        existing_nullable=False,
    )
