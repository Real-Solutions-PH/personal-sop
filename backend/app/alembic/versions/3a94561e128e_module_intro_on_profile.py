"""module intro on profile

Revision ID: 3a94561e128e
Revises: c3e7a1f05b92
Create Date: 2026-11-05 21:44:50.435855

The one-time reintroduction of a hidden part (a scored module, the Journal
or Community): which ones Fern has offered, and which the person turned
down for good. Both start empty and only grow.
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = "3a94561e128e"
down_revision = "c3e7a1f05b92"
branch_labels = None
depends_on = None


def upgrade():
    for name in ("intro_offered", "intro_dismissed"):
        op.add_column(
            "user_profile",
            sa.Column(
                name,
                postgresql.JSONB(astext_type=sa.Text()),
                server_default="[]",
                nullable=False,
            ),
        )


def downgrade():
    op.drop_column("user_profile", "intro_dismissed")
    op.drop_column("user_profile", "intro_offered")
