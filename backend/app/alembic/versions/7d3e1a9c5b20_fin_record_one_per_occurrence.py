"""fin_record: one live record per scheduled occurrence

``uq_fin_record_planned_occurrence`` makes (``planned_id``, ``planned_on``)
unique among live records, so the auto-log job, a Paid tap and a device's
optimistic copy can never produce two transactions for one occurrence of a
recurring item. Settlement already derives the record id from the pair; the
index makes the database hold the rule too.

Before the index is built, any extra live record on the same occurrence is
unlinked (``planned_id``/``planned_on`` set to null, oldest record kept):
the transaction itself stays, it just stops counting as that occurrence's
payment. The unlink is not undone on downgrade.

Revision ID: 7d3e1a9c5b20
Revises: 1ce5d2f4a857
Create Date: 2026-11-04 10:00:00.000000

"""

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "7d3e1a9c5b20"
down_revision = "1ce5d2f4a857"
branch_labels = None
depends_on = None

WHERE = "planned_id IS NOT NULL AND planned_on IS NOT NULL AND deleted_at IS NULL"


def upgrade() -> None:
    op.execute(
        f"""
        UPDATE fin_record SET planned_id = NULL, planned_on = NULL
        WHERE id IN (
            SELECT id FROM (
                SELECT id, row_number() OVER (
                    PARTITION BY planned_id, planned_on
                    ORDER BY created_at, id
                ) AS n
                FROM fin_record WHERE {WHERE}
            ) ranked
            WHERE n > 1
        )
        """
    )
    op.create_index(
        "uq_fin_record_planned_occurrence",
        "fin_record",
        ["planned_id", "planned_on"],
        unique=True,
        postgresql_where=sa.text(WHERE),
    )


def downgrade() -> None:
    op.drop_index(
        "uq_fin_record_planned_occurrence",
        table_name="fin_record",
        postgresql_where=sa.text(WHERE),
    )
