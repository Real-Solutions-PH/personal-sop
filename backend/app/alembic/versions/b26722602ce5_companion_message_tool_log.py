"""A Fern reply's tool calls and results, kept with the reply.

``companion_message.tool_log`` holds each tool call a reply made, with its
arguments and result cut to fit. Later turns read it, so "continue" after a
reply that ran out of steps picks up from what that reply already looked
up instead of starting over. Nullable: older replies have none.

Revision ID: b26722602ce5
Revises: 1d09f03e3aac
Create Date: 2026-11-05

"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "b26722602ce5"
down_revision = "1d09f03e3aac"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "companion_message",
        sa.Column("tool_log", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("companion_message", "tool_log")
