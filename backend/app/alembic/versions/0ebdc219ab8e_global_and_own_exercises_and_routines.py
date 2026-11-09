"""Built-in (global) and own exercises and routines.

Until now exercises, workout routines and their slots were one catalog every
member of a tenant read, editable by its author or an admin
(``c5e1d0a7b391``). From here on each table carries ``is_global``:

- a **global** row is built in: every member reads and uses it, nobody edits
  or deletes it through the API (``owned_repo.guard_write``);
- every other row is its **owner's** alone, like any owned row.

Carrying the existing rows over, per tenant, so nothing anyone logged loses
the row it points at:

- the seeded library (the 14 exercises and the Push A / Pull A / Legs A
  split, matched by their derived ids, tenant- or member-keyed, and live
  library exercises by name) is global;
- a routine some other member started a workout from is global, and so are
  a global routine's slots;
- an exercise some other member logged (``workout_exercise``, tombstones
  too), or that a global slot or another member's slot uses, is global; so
  is an exercise merged into a global one, and the survivor a global merged
  pointer points at (repeated until nothing changes);
- everything else stays its author's, now private. A slot whose owner is not
  its routine's owner (an admin edited another member's routine) passes to
  the routine's owner, so the routine keeps its slots.

Other members' phones already hold the rows that turned private. Each one
gets a ``sync_scope_exit`` record (entity, id, owner, a fresh sync version),
and ``/sync/pull`` ships those to every other member of the tenant as
deletions, so their phones drop them on the next pull.

The user-delete trigger now passes on only the global rows a deleted member
authored; their own rows go with them.

Downgrade drops the columns, the scope-exit table and restores the trigger;
every row is shared again. The slot owner realignment stays (harmless under
the shared rules).

Revision ID: 0ebdc219ab8e
Revises: 2f24e6183b14
Create Date: 2026-11-09

"""

import uuid

import sqlalchemy as sa
from alembic import op

revision = "0ebdc219ab8e"
down_revision = "2f24e6183b14"
branch_labels = None
depends_on = None

TABLES = ("exercise", "workout_template", "template_item")
EXIT = "sync_scope_exit"

# Frozen copies (app/shared/ids.py, app/modules/fitness/services.py).
DERIVED_NAMESPACE = uuid.UUID("6f1d7c2a-4b8e-5a3c-9d10-2e7f40b1c9a5")
LIBRARY = {
    "bench": "Barbell Bench Press",
    "incline-db": "Incline Dumbbell Press",
    "ohp": "Overhead Press",
    "lateral": "Lateral Raise",
    "pushdown": "Triceps Pushdown",
    "row": "Barbell Row",
    "pulldown": "Lat Pulldown",
    "pullup": "Pull-up",
    "facepull": "Face Pull",
    "curl": "Dumbbell Curl",
    "squat": "Back Squat",
    "rdl": "Romanian Deadlift",
    "legpress": "Leg Press",
    "plank": "Plank",
}
SPLIT = ("push-a", "pull-a", "legs-a")


def _derived(kind: str, parent: uuid.UUID, key: str) -> uuid.UUID:
    return uuid.uuid5(DERIVED_NAMESPACE, f"{kind}:{parent}:{key}")


def _pass_on_trigger(where: str) -> str:
    """``catalog_pass_on()``: before a user is deleted, the catalog rows
    they authored (``where`` narrows which) pass to an admin, else the
    longest-standing member."""
    updates = "".join(
        f"UPDATE {t} SET owner_id = heir WHERE owner_id = OLD.id{where.get(t, '')}; "
        for t in (*TABLES, "food_item")
    )
    return f"""
        CREATE OR REPLACE FUNCTION catalog_pass_on() RETURNS trigger
        LANGUAGE plpgsql AS $$
        DECLARE heir uuid;
        BEGIN
            SELECT id INTO heir FROM "user"
            WHERE tenant_id = OLD.tenant_id AND id <> OLD.id
            ORDER BY is_superuser DESC, created_at ASC NULLS LAST, id
            LIMIT 1;
            IF heir IS NOT NULL THEN
                {updates}
            END IF;
            RETURN OLD;
        END $$
        """


def _mark(conn: sa.Connection, table: str, cond: str) -> int:
    """Set ``is_global`` on the rows matching ``cond`` that lack it."""
    res = conn.execute(
        sa.text(
            f"UPDATE {table} x SET is_global = true WHERE NOT x.is_global AND ({cond})"
        )
    )
    return res.rowcount or 0


def _seeded_ids(conn: sa.Connection) -> tuple[list[uuid.UUID], list[uuid.UUID]]:
    """Every id the seeded library and split could carry: keyed on a tenant
    (since the shared catalog) or on a member (before it)."""
    parents = [r[0] for r in conn.execute(sa.text("SELECT id FROM tenant"))]
    parents += [r[0] for r in conn.execute(sa.text('SELECT id FROM "user"'))]
    ex = [_derived("exercise", p, k) for p in parents for k in LIBRARY]
    tpl = [_derived("template", p, k) for p in parents for k in SPLIT]
    return ex, tpl


def _carry_over(conn: sa.Connection) -> None:
    ex_ids, tpl_ids = _seeded_ids(conn)
    if ex_ids:
        conn.execute(
            sa.text("UPDATE exercise SET is_global = true WHERE id = ANY(:ids)"),
            {"ids": ex_ids},
        )
    if tpl_ids:
        conn.execute(
            sa.text(
                "UPDATE workout_template SET is_global = true WHERE id = ANY(:ids)"
            ),
            {"ids": tpl_ids},
        )
    conn.execute(
        sa.text(
            "UPDATE exercise SET is_global = true WHERE NOT is_global"
            " AND deleted_at IS NULL AND merged_into_id IS NULL"
            " AND lower(name) = ANY(:names)"
        ),
        {"names": [n.lower() for n in LIBRARY.values()]},
    )
    # A routine another member trained from.
    _mark(
        conn,
        "workout_template",
        "EXISTS (SELECT 1 FROM workout w WHERE w.template_id = x.id"
        " AND w.owner_id <> x.owner_id)",
    )
    # Slots belong to their routine's owner, and share its reach.
    conn.execute(
        sa.text(
            "UPDATE template_item ti SET owner_id = t.owner_id"
            " FROM workout_template t"
            " WHERE ti.template_id = t.id AND ti.owner_id <> t.owner_id"
        )
    )
    _mark(
        conn,
        "template_item",
        "EXISTS (SELECT 1 FROM workout_template t WHERE t.id = x.template_id"
        " AND t.is_global)",
    )
    # An exercise another member logged.
    _mark(
        conn,
        "exercise",
        "EXISTS (SELECT 1 FROM workout_exercise we WHERE we.exercise_id = x.id"
        " AND we.owner_id <> x.owner_id)",
    )
    # Slots, merge pointers and survivors, until nothing changes.
    for _ in range(50):
        n = _mark(
            conn,
            "exercise",
            "EXISTS (SELECT 1 FROM template_item ti WHERE ti.exercise_id = x.id"
            " AND (ti.is_global OR ti.owner_id <> x.owner_id))"
            " OR EXISTS (SELECT 1 FROM exercise s WHERE s.id = x.merged_into_id"
            " AND s.is_global)"
            " OR EXISTS (SELECT 1 FROM exercise p WHERE p.merged_into_id = x.id"
            " AND p.is_global)",
        )
        if not n:
            break


def _record_exits(conn: sa.Connection) -> None:
    """The live rows that turned private, for the other members' phones
    (only in a tenant that has other members)."""
    for table in TABLES:
        conn.execute(
            sa.text(
                f"""
                INSERT INTO {EXIT} (tenant_id, owner_id, entity, row_id, version)
                SELECT x.tenant_id, x.owner_id, '{table}', x.id,
                       nextval('sync_version_seq')
                FROM {table} x
                WHERE NOT x.is_global AND x.deleted_at IS NULL
                  AND EXISTS (SELECT 1 FROM "user" u
                              WHERE u.tenant_id = x.tenant_id AND u.id <> x.owner_id)
                """
            )
        )


def upgrade() -> None:
    for table in TABLES:
        op.add_column(
            table,
            sa.Column(
                "is_global",
                sa.Boolean(),
                server_default=sa.text("false"),
                nullable=False,
            ),
        )
    op.create_table(
        EXIT,
        sa.Column("id", sa.BigInteger(), sa.Identity(), primary_key=True),
        sa.Column(
            "tenant_id",
            sa.Uuid(),
            sa.ForeignKey("tenant.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "owner_id",
            sa.Uuid(),
            sa.ForeignKey("user.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("entity", sa.String(length=40), nullable=False),
        sa.Column("row_id", sa.Uuid(), nullable=False),
        sa.Column("version", sa.BigInteger(), nullable=False),
    )
    op.create_index("ix_sync_scope_exit_owner_version", EXIT, ["owner_id", "version"])
    op.execute(f"ALTER TABLE {EXIT} ENABLE ROW LEVEL SECURITY")
    op.execute(
        f"""
        CREATE POLICY {EXIT}_tenant_isolation ON {EXIT}
            USING (tenant_id = app_tenant_id())
            WITH CHECK (tenant_id = app_tenant_id())
        """
    )
    conn = op.get_bind()
    _carry_over(conn)
    _record_exits(conn)
    op.execute(_pass_on_trigger({t: " AND is_global" for t in TABLES}))


def downgrade() -> None:
    op.execute(_pass_on_trigger({}))
    op.execute(f"DROP POLICY {EXIT}_tenant_isolation ON {EXIT}")
    op.drop_index("ix_sync_scope_exit_owner_version", table_name=EXIT)
    op.drop_table(EXIT)
    for table in reversed(TABLES):
        op.drop_column(table, "is_global")
