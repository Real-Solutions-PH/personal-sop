"""Join the two heads: profile occupation/referral and exercise merge.

Both revisions were written on c4f2a8e61d07 in parallel and merged to
master separately, which left two heads. Nothing changes in the schema.

Revision ID: b670ce81fb23
Revises: b40916735ea7, efbedcc8af57
Create Date: 2026-10-30

"""

revision = "b670ce81fb23"
down_revision = ("b40916735ea7", "efbedcc8af57")
branch_labels = None
depends_on = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
