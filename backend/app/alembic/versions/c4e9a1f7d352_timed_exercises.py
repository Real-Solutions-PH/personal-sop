"""Timed exercises: walking, running, planks.

A timed exercise records each set's duration and, optionally, its speed
(walking, running) or added weight (a weighted plank); a template can give
it a time goal. Adds the "cardio" muscle group.

Revision ID: c4e9a1f7d352
Revises: b8d2f4a6c913
Create Date: 2026-10-23

"""

import sqlalchemy as sa
from alembic import op

revision = "c4e9a1f7d352"
down_revision = "b8d2f4a6c913"
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
)


def _muscles(values: tuple[str, ...]) -> str:
    return "muscle IN (" + ", ".join(f"'{v}'" for v in values) + ")"


def upgrade() -> None:
    op.add_column("exercise", sa.Column("track", sa.String(length=8), nullable=True))
    op.create_check_constraint(
        "ck_exercise_track", "exercise", "track IS NULL OR track IN ('speed', 'weight')"
    )
    op.drop_constraint("ck_exercise_muscle", "exercise", type_="check")
    op.create_check_constraint(
        "ck_exercise_muscle", "exercise", _muscles((*OLD_MUSCLES, "cardio"))
    )
    op.add_column("template_item", sa.Column("target_sec", sa.Integer(), nullable=True))
    op.create_check_constraint(
        "ck_template_item_target",
        "template_item",
        "target_sec IS NULL OR target_sec BETWEEN 1 AND 86400",
    )
    op.add_column("workout_set", sa.Column("duration_sec", sa.Integer(), nullable=True))
    op.add_column("workout_set", sa.Column("speed_kmh", sa.Float(), nullable=True))
    op.create_check_constraint(
        "ck_workout_set_duration",
        "workout_set",
        "duration_sec IS NULL OR duration_sec BETWEEN 0 AND 86400",
    )
    op.create_check_constraint(
        "ck_workout_set_speed",
        "workout_set",
        "speed_kmh IS NULL OR (speed_kmh >= 0 AND speed_kmh <= 60)",
    )


def downgrade() -> None:
    op.drop_constraint("ck_workout_set_speed", "workout_set", type_="check")
    op.drop_constraint("ck_workout_set_duration", "workout_set", type_="check")
    op.drop_column("workout_set", "speed_kmh")
    op.drop_column("workout_set", "duration_sec")
    op.drop_constraint("ck_template_item_target", "template_item", type_="check")
    op.drop_column("template_item", "target_sec")
    # Exercises filed under cardio go back to core before the old check returns.
    op.execute("UPDATE exercise SET muscle = 'core' WHERE muscle = 'cardio'")
    op.drop_constraint("ck_exercise_muscle", "exercise", type_="check")
    op.create_check_constraint("ck_exercise_muscle", "exercise", _muscles(OLD_MUSCLES))
    op.drop_constraint("ck_exercise_track", "exercise", type_="check")
    op.drop_column("exercise", "track")
