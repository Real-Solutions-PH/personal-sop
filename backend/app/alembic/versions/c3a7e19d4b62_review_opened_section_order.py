"""review opened_at and section order

``review.opened_at`` is the first time the person opened a review: Today's
weekly review card stays until then and for one day after, on every device.
Nullable: a review nobody opened has none.

``module_pref.sort_order`` is the place of a module's cards in the app, set
by dragging in Settings → Sections. Existing rows get 0, and ties keep the
default module order, so nothing moves until the person reorders.

Revision ID: c3a7e19d4b62
Revises: ac496d561a8c
Create Date: 2026-11-03 12:00:00.000000

"""

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "c3a7e19d4b62"
down_revision = "ac496d561a8c"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "review",
        sa.Column("opened_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "module_pref",
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
    )
    op.create_check_constraint(
        "ck_module_pref_sort_order",
        "module_pref",
        "sort_order BETWEEN 0 AND 99",
    )


def downgrade() -> None:
    op.drop_constraint("ck_module_pref_sort_order", "module_pref", type_="check")
    op.drop_column("module_pref", "sort_order")
    op.drop_column("review", "opened_at")
