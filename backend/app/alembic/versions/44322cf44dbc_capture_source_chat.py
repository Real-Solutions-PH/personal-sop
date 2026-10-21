"""capture source chat

Revision ID: 44322cf44dbc
Revises: 466bdf099326
Create Date: 2026-10-22 02:33:23.912981

"""

from alembic import op

# revision identifiers, used by Alembic.
revision = "44322cf44dbc"
down_revision = "466bdf099326"
branch_labels = None
depends_on = None


OLD = "('text', 'voice', 'photo', 'file', 'quick_add', 'connector')"
NEW = "('text', 'voice', 'photo', 'file', 'quick_add', 'connector', 'chat')"


def upgrade():
    # A chat turn's writes hang off a capture of their own (ADR-0015).
    op.drop_constraint("ck_capture_source", "capture", type_="check")
    op.create_check_constraint("ck_capture_source", "capture", f"source IN {NEW}")


def downgrade():
    # Chat captures cannot satisfy the old constraint; they become text.
    op.execute("UPDATE capture SET source = 'text' WHERE source = 'chat'")
    op.drop_constraint("ck_capture_source", "capture", type_="check")
    op.create_check_constraint("ck_capture_source", "capture", f"source IN {OLD}")
