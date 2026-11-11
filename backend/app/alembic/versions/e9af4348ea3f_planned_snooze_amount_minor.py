"""planned_snooze.amount_minor: one scheduled date's own amount.

A scheduled payment's single date can now carry its own amount ("this
month's bill is ₱3,480") beside the day it moved to, on the same
``planned_snooze`` row, without changing the plan. Null keeps the plan's
amount, so every existing row reads as before; no backfill.

Revision ID: e9af4348ea3f
Revises: fddd1ce9e22e
Create Date: 2026-11-12 00:23:32.136175

"""

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "e9af4348ea3f"
down_revision = "fddd1ce9e22e"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "planned_snooze", sa.Column("amount_minor", sa.BigInteger(), nullable=True)
    )
    op.create_check_constraint(
        "ck_planned_snooze_amount",
        "planned_snooze",
        "amount_minor IS NULL OR "
        "(amount_minor > 0 AND amount_minor <= 100000000000000)",
    )


def downgrade() -> None:
    op.drop_constraint("ck_planned_snooze_amount", "planned_snooze", type_="check")
    op.drop_column("planned_snooze", "amount_minor")
