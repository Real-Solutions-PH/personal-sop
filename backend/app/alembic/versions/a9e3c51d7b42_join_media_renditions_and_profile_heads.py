"""Join the two heads: media renditions and the profile/exercise-merge join.

Both were merged to master in parallel, each resolving the earlier split
on its own, which left two heads again. Nothing changes in the schema.

Revision ID: a9e3c51d7b42
Revises: 5d1ede2701f9, b670ce81fb23
Create Date: 2026-10-30

"""

revision = "a9e3c51d7b42"
down_revision = ("5d1ede2701f9", "b670ce81fb23")
branch_labels = None
depends_on = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
