"""home layout on profile

Revision ID: 7c4d2e9a1b36
Revises: b26722602ce5
Create Date: 2026-11-06 12:00:00.000000

Home's sections in the person's order and the ones they hid there, as
{"order": [...], "hidden": [...]}. NULL (every existing row) means the
default arrangement, so nothing to backfill.
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = "7c4d2e9a1b36"
down_revision = "b26722602ce5"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "user_profile",
        sa.Column(
            "home_layout", postgresql.JSONB(astext_type=sa.Text()), nullable=True
        ),
    )


def downgrade():
    op.drop_column("user_profile", "home_layout")
