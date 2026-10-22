"""Task tags: free labels on a task, shown in the lists.

Revision ID: a3c7e91d5b20
Revises: f2a8c4d6e1b7
Create Date: 2026-10-23

"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "a3c7e91d5b20"
down_revision = "f2a8c4d6e1b7"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Existing tasks get no tags; the server default backfills them.
    op.add_column(
        "task",
        sa.Column(
            "tags",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default="[]",
            nullable=False,
        ),
    )


def downgrade() -> None:
    op.drop_column("task", "tags")
