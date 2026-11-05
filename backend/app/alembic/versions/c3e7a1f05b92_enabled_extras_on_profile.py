"""enabled extras on profile

Revision ID: c3e7a1f05b92
Revises: 5a08603e6619
Create Date: 2026-11-05 21:30:00.000000

Which extras (journal, social, weather, calendar) a person keeps shown, moved
from a setting kept on one phone to the account. NULL for every existing
profile: never chosen on the server, so every extra counts as shown until
the phone uploads its old on-device choice.
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = "c3e7a1f05b92"
down_revision = "5a08603e6619"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "user_profile",
        sa.Column(
            "enabled_extras",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=True,
        ),
    )


def downgrade():
    op.drop_column("user_profile", "enabled_extras")
