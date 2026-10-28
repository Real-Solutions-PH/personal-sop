"""Per-set weight unit; calves and forearms muscle groups.

A set remembers whether its weight was entered in kg or lb (the weight
itself stays kilograms); null keeps following the settings unit. Adds the
"calves" and "forearms" muscle groups.

Revision ID: a7c3e9d51f20
Revises: 958f09719229
Create Date: 2026-10-28

"""

import sqlalchemy as sa
from alembic import op

revision = "a7c3e9d51f20"
down_revision = "958f09719229"
branch_labels = None
depends_on = None

OLD_MUSCLES = (
    "chest",
    "back",
    "shoulders",
    "biceps",
    "triceps",
    "quads",
    "hamstrings",
    "glutes",
    "core",
    "cardio",
)


def _muscles(values: tuple[str, ...]) -> str:
    return "muscle IN (" + ", ".join(f"'{v}'" for v in values) + ")"


def upgrade() -> None:
    op.add_column("workout_set", sa.Column("unit", sa.String(length=2), nullable=True))
    op.create_check_constraint(
        "ck_workout_set_unit", "workout_set", "unit IS NULL OR unit IN ('kg', 'lb')"
    )
    op.drop_constraint("ck_exercise_muscle", "exercise", type_="check")
    op.create_check_constraint(
        "ck_exercise_muscle",
        "exercise",
        _muscles((*OLD_MUSCLES, "calves", "forearms")),
    )


def downgrade() -> None:
    # Calves go back under quads, forearms under biceps, before the old check.
    op.execute("UPDATE exercise SET muscle = 'quads' WHERE muscle = 'calves'")
    op.execute("UPDATE exercise SET muscle = 'biceps' WHERE muscle = 'forearms'")
    op.drop_constraint("ck_exercise_muscle", "exercise", type_="check")
    op.create_check_constraint("ck_exercise_muscle", "exercise", _muscles(OLD_MUSCLES))
    op.drop_constraint("ck_workout_set_unit", "workout_set", type_="check")
    op.drop_column("workout_set", "unit")
