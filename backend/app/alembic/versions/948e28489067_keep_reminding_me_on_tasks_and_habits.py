"""Keep reminding me: tasks and habits get ``nag_every_min``.

NULL = off. When set, the phone repeats an overdue reminder every this
many minutes for the rest of that day.

Revision ID: 948e28489067
Revises: da6a0c041e3e
Create Date: 2026-11-01 20:46:51.235806

"""

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "948e28489067"
down_revision = "da6a0c041e3e"
branch_labels = None
depends_on = None

TABLES = (("task", "ck_task_nag_every"), ("habit", "ck_habit_nag_every"))


def upgrade() -> None:
    for table, check in TABLES:
        op.add_column(table, sa.Column("nag_every_min", sa.Integer(), nullable=True))
        op.create_check_constraint(
            check, table, "nag_every_min IS NULL OR nag_every_min BETWEEN 15 AND 720"
        )


def downgrade() -> None:
    for table, check in TABLES:
        op.drop_constraint(check, table, type_="check")
        op.drop_column(table, "nag_every_min")
