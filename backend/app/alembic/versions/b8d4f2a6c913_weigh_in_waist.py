"""weigh_in: waist_cm

Revision ID: b8d4f2a6c913
Revises: ec27c6bfa274
Create Date: 2026-11-15 12:00:00.000000

A weigh-in can carry a waist measurement in centimetres, nullable like body
fat. Lean and fat mass are not stored: they follow from weight and body fat.
"""

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "b8d4f2a6c913"
down_revision = "ec27c6bfa274"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("weigh_in", sa.Column("waist_cm", sa.Float(), nullable=True))
    op.create_check_constraint(
        "ck_weigh_in_waist",
        "weigh_in",
        "waist_cm IS NULL OR (waist_cm > 0 AND waist_cm < 300)",
    )


def downgrade() -> None:
    op.drop_constraint("ck_weigh_in_waist", "weigh_in", type_="check")
    op.drop_column("weigh_in", "waist_cm")
