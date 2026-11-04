"""fern eval consent on profile

Revision ID: 5a08603e6619
Revises: 7d3e1a9c5b20
Create Date: 2026-11-04 21:04:30.909773

The opt-in for anonymised copies of a person's chats to be used to test
Fern (ADR-0034): off for every existing and new profile, and when it was
last turned on or off.
"""

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "5a08603e6619"
down_revision = "7d3e1a9c5b20"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "user_profile",
        sa.Column(
            "fern_eval_consent",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
    )
    op.add_column(
        "user_profile",
        sa.Column("fern_eval_consent_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade():
    op.drop_column("user_profile", "fern_eval_consent_at")
    op.drop_column("user_profile", "fern_eval_consent")
