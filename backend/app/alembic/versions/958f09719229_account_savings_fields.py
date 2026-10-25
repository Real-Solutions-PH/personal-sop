"""account savings fields

Revision ID: 958f09719229
Revises: 1ebb07396f48
Create Date: 2026-10-25 12:00:00.000000

"""
import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "958f09719229"
down_revision = "1ebb07396f48"
branch_labels = None
depends_on = None


def upgrade():
    # Interest rate (basis points), time-deposit maturity and a savings goal.
    # All nullable: existing accounts have none of them.
    op.add_column("account", sa.Column("rate_bp", sa.Integer(), nullable=True))
    op.add_column("account", sa.Column("matures_on", sa.Date(), nullable=True))
    op.add_column("account", sa.Column("goal_minor", sa.BigInteger(), nullable=True))
    op.add_column("account", sa.Column("goal_by", sa.Date(), nullable=True))
    op.create_check_constraint(
        "ck_account_rate", "account", "rate_bp IS NULL OR rate_bp BETWEEN 0 AND 10000"
    )
    op.create_check_constraint(
        "ck_account_goal", "account", "goal_minor BETWEEN 0 AND 100000000000000"
    )


def downgrade():
    op.drop_constraint("ck_account_goal", "account", type_="check")
    op.drop_constraint("ck_account_rate", "account", type_="check")
    op.drop_column("account", "goal_by")
    op.drop_column("account", "goal_minor")
    op.drop_column("account", "matures_on")
    op.drop_column("account", "rate_bp")
