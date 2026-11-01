"""Join the exercise merge and the onboarding revisions into one head.

Both branched from ``c4f2a8e61d07``; this revision only joins them.

Revision ID: a3c19e7d2b44
Revises: b40916735ea7, efbedcc8af57
Create Date: 2026-10-30

"""

revision = "a3c19e7d2b44"
down_revision = ("b40916735ea7", "efbedcc8af57")
branch_labels = None
depends_on = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
