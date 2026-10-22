"""meal item nutrient detail

Fiber, saturated fat and sugar (grams) and sodium (milligrams) per meal
item. Nullable: older meals and estimates without them stay valid.

Revision ID: 7c1e5b9a2d40
Revises: 99cf93264ac0
Create Date: 2026-10-22 13:00:00.000000

"""

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "7c1e5b9a2d40"
down_revision = "99cf93264ac0"
branch_labels = None
depends_on = None

COLUMNS = ("fiber", "sat_fat", "sugar", "sodium")


def upgrade():
    for name in COLUMNS:
        op.add_column("meal_item", sa.Column(name, sa.Float(), nullable=True))
    op.create_check_constraint(
        "ck_meal_item_detail_nonneg",
        "meal_item",
        "(fiber IS NULL OR fiber >= 0) AND (sat_fat IS NULL OR sat_fat >= 0)"
        " AND (sugar IS NULL OR sugar >= 0) AND (sodium IS NULL OR sodium >= 0)",
    )


def downgrade():
    op.drop_constraint("ck_meal_item_detail_nonneg", "meal_item", type_="check")
    for name in reversed(COLUMNS):
        op.drop_column("meal_item", name)
