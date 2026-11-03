"""run session indoor and incline

``run_session.indoor`` marks a session done on a treadmill: it has no route
and its ``distance_m`` is the one the person entered from the machine (or
the phone's step-based estimate until they do). Existing rows were all
recorded outdoors with GPS, so they get false.

``run_session.incline_pct`` is the treadmill's incline, 0 to 40 percent;
null outdoors and when not entered.

Revision ID: 1ce5d2f4a857
Revises: c3a7e19d4b62
Create Date: 2026-11-03 15:22:48.997941

"""

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "1ce5d2f4a857"
down_revision = "c3a7e19d4b62"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "run_session",
        sa.Column(
            "indoor", sa.Boolean(), server_default=sa.text("false"), nullable=False
        ),
    )
    op.add_column("run_session", sa.Column("incline_pct", sa.Float(), nullable=True))
    op.create_check_constraint(
        "ck_run_session_incline",
        "run_session",
        "incline_pct IS NULL OR (incline_pct >= 0 AND incline_pct <= 40)",
    )


def downgrade() -> None:
    op.drop_constraint("ck_run_session_incline", "run_session", type_="check")
    op.drop_column("run_session", "incline_pct")
    op.drop_column("run_session", "indoor")
