"""social cheer kinds

Revision ID: d81c5f0a3b72
Revises: a65a6331fd8c
Create Date: 2026-10-22 18:00:00.000000

"""

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "d81c5f0a3b72"
down_revision = "a65a6331fd8c"
branch_labels = None
depends_on = None


def upgrade():
    # A like becomes a cheer of one kind. Existing likes read as "keep going"
    # through the server default, so no separate backfill is needed.
    op.add_column(
        "post_like",
        sa.Column("kind", sa.String(10), nullable=False, server_default="keep_going"),
    )
    op.create_check_constraint(
        "ck_post_like_kind",
        "post_like",
        "kind IN ('keep_going', 'proud', 'inspired')",
    )


def downgrade():
    op.drop_constraint("ck_post_like_kind", "post_like", type_="check")
    op.drop_column("post_like", "kind")
