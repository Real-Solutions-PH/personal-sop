"""nudge topic and recent_push suppression

Revision ID: 626f9ababa93
Revises: ec27c6bfa274
Create Date: 2026-11-15 09:35:15.935390

Persona-based nudges from Fern: ``nudge.topic`` records what a best-time
nudge was about (bill_due, near_best, wrap_up, ...; null for ladder steps),
and ``recent_push`` joins the reasons a nudge is held back (another push
went out under 45 minutes before). No data changes on the way up; on the
way down the topic goes and a ``recent_push`` row becomes ``budget``.
"""

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "626f9ababa93"
down_revision = "ec27c6bfa274"
branch_labels = None
depends_on = None

OLD_SUPPRESSED = (
    "suppressed IS NULL OR suppressed IN ('opt_out', 'active_today', 'quiet',"
    " 'fatigue', 'backoff', 'budget', 'no_content', 'no_push', 'holdout')"
)
NEW_SUPPRESSED = (
    "suppressed IS NULL OR suppressed IN ('opt_out', 'active_today', 'quiet',"
    " 'fatigue', 'backoff', 'budget', 'no_content', 'no_push', 'holdout',"
    " 'recent_push')"
)


def upgrade() -> None:
    op.add_column("nudge", sa.Column("topic", sa.String(length=16), nullable=True))
    op.drop_constraint("ck_nudge_suppressed", "nudge", type_="check")
    op.create_check_constraint("ck_nudge_suppressed", "nudge", NEW_SUPPRESSED)


def downgrade() -> None:
    op.execute(
        "UPDATE nudge SET suppressed = 'budget' WHERE suppressed = 'recent_push'"
    )
    op.drop_constraint("ck_nudge_suppressed", "nudge", type_="check")
    op.create_check_constraint("ck_nudge_suppressed", "nudge", OLD_SUPPRESSED)
    op.drop_column("nudge", "topic")
