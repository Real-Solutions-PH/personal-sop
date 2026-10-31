"""finance settings bill reminder time

``finance_settings.bill_reminder``: the HH:MM a bill's daily reminders fire
at in the week before it's due, or NULL for off. Existing rows get 09:00.

Revision ID: b7e3d9a41c52
Revises: c4f2a8e61d07
Create Date: 2026-10-31 12:00:00.000000

"""

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "b7e3d9a41c52"
down_revision = "c4f2a8e61d07"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "finance_settings",
        sa.Column(
            "bill_reminder",
            sa.String(length=5),
            nullable=True,
            server_default="09:00",
        ),
    )


def downgrade() -> None:
    op.drop_column("finance_settings", "bill_reminder")
