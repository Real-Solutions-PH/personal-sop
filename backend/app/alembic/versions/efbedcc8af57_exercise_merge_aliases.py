"""Exercise merge: aliases, a merged-into pointer, and an exact-name backfill.

``exercise`` gains ``aliases`` (former names that resolve to it) and
``merged_into_id`` (set on a merged row, which stays archived as a pointer to
its survivor). The backfill merges each account's exact duplicates: live,
unmerged rows of one owner and load type whose names match ignoring case and
runs of whitespace. The survivor is the row with the most live workout
references, then the oldest, then the lowest id. Every reference and archive
flag it changes is recorded in ``exercise_merge_undo`` so the downgrade can
put it back; merges made later through the app are not recorded and stay
merged after a downgrade (only the two columns go).

Revision ID: efbedcc8af57
Revises: c4f2a8e61d07
Create Date: 2026-10-30

"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision = "efbedcc8af57"
down_revision = "c4f2a8e61d07"
branch_labels = None
depends_on = None

UNDO = "exercise_merge_undo"

# One row per duplicate to fold: (loser, survivor, tenant, loser's archived).
MERGE_MAP = r"""
CREATE TEMP TABLE _exercise_merge_map AS
WITH refs AS (
    SELECT exercise_id, count(*) AS n
    FROM workout_exercise
    WHERE deleted_at IS NULL
    GROUP BY exercise_id
),
live AS (
    SELECT e.id, e.tenant_id, e.owner_id, e.load_type, e.created_at, e.archived,
           lower(regexp_replace(btrim(e.name), '\s+', ' ', 'g')) AS name_key,
           coalesce(r.n, 0) AS n
    FROM exercise e
    LEFT JOIN refs r ON r.exercise_id = e.id
    WHERE e.deleted_at IS NULL AND e.merged_into_id IS NULL
),
ranked AS (
    SELECT id, tenant_id, archived,
           row_number() OVER w AS rk,
           first_value(id) OVER w AS survivor
    FROM live
    WINDOW w AS (
        PARTITION BY owner_id, load_type, name_key
        ORDER BY n DESC, created_at ASC, id ASC
    )
)
SELECT id AS loser, survivor, tenant_id, archived
FROM ranked
WHERE rk > 1
"""


def upgrade() -> None:
    op.add_column(
        "exercise",
        sa.Column(
            "aliases",
            JSONB(),
            server_default=sa.text("'[]'::jsonb"),
            nullable=False,
        ),
    )
    op.add_column("exercise", sa.Column("merged_into_id", sa.Uuid(), nullable=True))
    op.create_foreign_key(
        "fk_exercise_merged_into",
        "exercise",
        "exercise",
        ["merged_into_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index("ix_exercise_merged_into_id", "exercise", ["merged_into_id"])
    op.create_check_constraint(
        "ck_exercise_not_self_merged",
        "exercise",
        "merged_into_id IS NULL OR merged_into_id <> id",
    )

    # Ids and one flag only: enough to put each moved reference back.
    op.create_table(
        UNDO,
        sa.Column("id", sa.BigInteger(), sa.Identity(), primary_key=True),
        sa.Column("tenant_id", sa.Uuid(), nullable=False),
        sa.Column("table_name", sa.Text(), nullable=False),
        sa.Column("row_id", sa.Uuid(), nullable=False),
        sa.Column("old_exercise_id", sa.Uuid(), nullable=True),
        sa.Column("old_archived", sa.Boolean(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
    )
    op.execute(f"ALTER TABLE {UNDO} ENABLE ROW LEVEL SECURITY")
    op.execute(
        f"""
        CREATE POLICY {UNDO}_tenant_isolation ON {UNDO}
            USING (tenant_id = app_tenant_id())
            WITH CHECK (tenant_id = app_tenant_id())
        """
    )

    op.execute(MERGE_MAP)
    for table in ("workout_exercise", "template_item"):
        op.execute(
            f"""
            INSERT INTO {UNDO} (tenant_id, table_name, row_id, old_exercise_id)
            SELECT t.tenant_id, '{table}', t.id, t.exercise_id
            FROM {table} t
            JOIN _exercise_merge_map m ON m.loser = t.exercise_id
            """
        )
        op.execute(
            f"""
            UPDATE {table} t SET exercise_id = m.survivor
            FROM _exercise_merge_map m
            WHERE t.exercise_id = m.loser
            """
        )
    op.execute(
        f"""
        INSERT INTO {UNDO} (tenant_id, table_name, row_id, old_archived)
        SELECT tenant_id, 'exercise', loser, archived FROM _exercise_merge_map
        """
    )
    op.execute(
        """
        UPDATE exercise e SET merged_into_id = m.survivor, archived = true
        FROM _exercise_merge_map m
        WHERE e.id = m.loser
        """
    )
    op.execute("DROP TABLE _exercise_merge_map")


def downgrade() -> None:
    for table in ("workout_exercise", "template_item"):
        op.execute(
            f"""
            UPDATE {table} t SET exercise_id = u.old_exercise_id
            FROM {UNDO} u
            WHERE u.table_name = '{table}' AND u.row_id = t.id
            """
        )
    op.execute(
        f"""
        UPDATE exercise e SET archived = u.old_archived
        FROM {UNDO} u
        WHERE u.table_name = 'exercise' AND u.row_id = e.id
        """
    )
    op.drop_table(UNDO)
    op.drop_constraint("ck_exercise_not_self_merged", "exercise", type_="check")
    op.drop_index("ix_exercise_merged_into_id", table_name="exercise")
    op.drop_constraint("fk_exercise_merged_into", "exercise", type_="foreignkey")
    op.drop_column("exercise", "merged_into_id")
    op.drop_column("exercise", "aliases")
