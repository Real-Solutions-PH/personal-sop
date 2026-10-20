"""AI settings: the model a user picked for the server's own key.

Nullable: no pick means the server default (settings.NEBIUS_MODEL).

Revision ID: 6dbabc13d112
Revises: 6df6f75a2737
Create Date: 2026-10-20 09:04:27.275039

"""

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "6dbabc13d112"
down_revision = "6df6f75a2737"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("ai_settings", sa.Column("model", sa.String(160), nullable=True))


def downgrade() -> None:
    op.drop_column("ai_settings", "model")
