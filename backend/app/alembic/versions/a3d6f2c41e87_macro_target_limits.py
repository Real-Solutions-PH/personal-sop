"""macro target limits

Per-user daily limits on the macro target: saturated fat and sugar
(grams), sodium (milligrams), and the fiber goal (grams). Nullable: NULL
means the WHO default, so every existing target keeps reading as before.

Revision ID: a3d6f2c41e87
Revises: 7c1e5b9a2d40
Create Date: 2026-10-22 15:00:00.000000

"""

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "a3d6f2c41e87"
down_revision = "7c1e5b9a2d40"
branch_labels = None
depends_on = None

COLUMNS = ("sat_fat_max_g", "sugar_max_g", "sodium_max_mg", "fiber_g")


def upgrade():
    for name in COLUMNS:
        op.add_column("macro_target", sa.Column(name, sa.Float(), nullable=True))
    op.create_check_constraint(
        "ck_macro_target_limits_nonneg",
        "macro_target",
        "(sat_fat_max_g IS NULL OR sat_fat_max_g >= 0)"
        " AND (sugar_max_g IS NULL OR sugar_max_g >= 0)"
        " AND (sodium_max_mg IS NULL OR sodium_max_mg >= 0)"
        " AND (fiber_g IS NULL OR fiber_g >= 0)",
    )


def downgrade():
    op.drop_constraint("ck_macro_target_limits_nonneg", "macro_target", type_="check")
    for name in reversed(COLUMNS):
        op.drop_column("macro_target", name)
