"""fiber split

Soluble and insoluble fiber in grams on meal items and library foods, and
a daily goal for each on the macro target. Nullable: an item logged before
this, or one whose split is not known, carries only its total fiber, and a
NULL goal means none is set (there is no WHO default to fall back to).

Revision ID: ac496d561a8c
Revises: f793f04838a4
Create Date: 2026-11-02 12:00:00.000000

"""

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "ac496d561a8c"
down_revision = "f793f04838a4"
branch_labels = None
depends_on = None

ITEMS = (
    ("meal_item", "ck_meal_item_fiber_split_nonneg"),
    ("food_item", "ck_food_item_fiber_split_nonneg"),
)
SPLIT = ("fiber_soluble", "fiber_insoluble")
GOALS = ("fiber_soluble_g", "fiber_insoluble_g")


def _nonneg(columns: tuple[str, ...]) -> str:
    return " AND ".join(f"({c} IS NULL OR {c} >= 0)" for c in columns)


def upgrade():
    for table, check in ITEMS:
        for name in SPLIT:
            op.add_column(table, sa.Column(name, sa.Float(), nullable=True))
        op.create_check_constraint(check, table, _nonneg(SPLIT))
    for name in GOALS:
        op.add_column("macro_target", sa.Column(name, sa.Float(), nullable=True))
    op.create_check_constraint(
        "ck_macro_target_fiber_split_nonneg", "macro_target", _nonneg(GOALS)
    )


def downgrade():
    op.drop_constraint(
        "ck_macro_target_fiber_split_nonneg", "macro_target", type_="check"
    )
    for name in reversed(GOALS):
        op.drop_column("macro_target", name)
    for table, check in reversed(ITEMS):
        op.drop_constraint(check, table, type_="check")
        for name in reversed(SPLIT):
            op.drop_column(table, name)
