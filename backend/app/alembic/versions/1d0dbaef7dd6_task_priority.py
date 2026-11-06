"""Tasks get a ``priority``: none, low, medium or high.

Existing rows become "none" through the server default. Four levels, not
five: overdue already says "now", so an "urgent" level would only split
"high" in two.

Revision ID: 1d0dbaef7dd6
Revises: b26722602ce5
Create Date: 2026-11-06 13:43:27.355715

"""

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "1d0dbaef7dd6"
down_revision = "b26722602ce5"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "task",
        sa.Column(
            "priority", sa.String(length=6), server_default="none", nullable=False
        ),
    )
    op.create_check_constraint(
        "ck_task_priority",
        "task",
        "priority IN ('none', 'low', 'medium', 'high')",
    )


def downgrade() -> None:
    op.drop_constraint("ck_task_priority", "task", type_="check")
    op.drop_column("task", "priority")
