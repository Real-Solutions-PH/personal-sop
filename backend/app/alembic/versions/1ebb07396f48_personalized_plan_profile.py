"""personalized plan profile

Revision ID: 1ebb07396f48
Revises: 18269ea0c979
Create Date: 2026-10-25 06:18:11.057922

"""
import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "1ebb07396f48"
down_revision = "18269ea0c979"
branch_labels = None
depends_on = None

_CHECKS = {
    "ck_fitness_sex": "sex IN ('male', 'female')",
    "ck_fitness_activity": (
        "activity_level IN ('sedentary', 'light', 'moderate', 'active', 'very_active')"
    ),
    "ck_fitness_plan_goal": "plan_goal IN ('lose', 'maintain', 'recomp', 'build')",
    "ck_fitness_height": "height_cm IS NULL OR height_cm BETWEEN 100 AND 250",
    "ck_fitness_birth_year": "birth_year IS NULL OR birth_year >= 1900",
}


def upgrade():
    op.add_column("fitness_settings", sa.Column("sex", sa.String(length=6), nullable=True))
    op.add_column("fitness_settings", sa.Column("birth_year", sa.Integer(), nullable=True))
    op.add_column("fitness_settings", sa.Column("height_cm", sa.Float(), nullable=True))
    op.add_column(
        "fitness_settings", sa.Column("activity_level", sa.String(length=11), nullable=True)
    )
    op.add_column("fitness_settings", sa.Column("plan_goal", sa.String(length=8), nullable=True))
    for name, expr in _CHECKS.items():
        op.create_check_constraint(name, "fitness_settings", expr)


def downgrade():
    for name in _CHECKS:
        op.drop_constraint(name, "fitness_settings", type_="check")
    for col in ("plan_goal", "activity_level", "height_cm", "birth_year", "sex"):
        op.drop_column("fitness_settings", col)
