"""The companion's default name moves from Sol to Fern.

Companions still carrying the old default become Fern. A name of exactly
"Sol" cannot be told apart from the old default, so it moves too; any other
name a user chose is left alone. Downgrade moves the default back the same
way.

Revision ID: 2bc76ea88d36
Revises: 6dbabc13d112
Create Date: 2026-10-20

"""

from alembic import op

# revision identifiers, used by Alembic.
revision = "2bc76ea88d36"
down_revision = "6dbabc13d112"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("UPDATE companion SET name = 'Fern' WHERE name = 'Sol'")


def downgrade() -> None:
    op.execute("UPDATE companion SET name = 'Sol' WHERE name = 'Fern'")
