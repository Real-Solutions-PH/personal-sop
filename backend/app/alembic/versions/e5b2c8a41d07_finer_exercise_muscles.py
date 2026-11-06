"""Finer exercise muscles: delts, lats, traps, abductors, adductors and more.

Widens the exercise muscle check with the muscles lifting apps list beside
the broad groups. No stored value changes on the way up.

Revision ID: e5b2c8a41d07
Revises: 1d0dbaef7dd6
Create Date: 2026-11-06

"""

from alembic import op

revision = "e5b2c8a41d07"
down_revision = "1d0dbaef7dd6"
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
    "calves",
    "forearms",
)
# Each new muscle and the broad group it folds back into on downgrade.
NEW_MUSCLES = {
    "upper_chest": "chest",
    "front_delts": "shoulders",
    "side_delts": "shoulders",
    "rear_delts": "shoulders",
    "lats": "back",
    "traps": "back",
    "rhomboids": "back",
    "lower_back": "back",
    "obliques": "core",
    "abductors": "glutes",
    "adductors": "quads",
    "tibialis": "calves",
    "hip_flexors": "quads",
    "neck": "back",
}


def _muscles(values: tuple[str, ...]) -> str:
    return "muscle IN (" + ", ".join(f"'{v}'" for v in values) + ")"


def upgrade() -> None:
    op.drop_constraint("ck_exercise_muscle", "exercise", type_="check")
    op.create_check_constraint(
        "ck_exercise_muscle",
        "exercise",
        _muscles((*OLD_MUSCLES, *NEW_MUSCLES)),
    )


def downgrade() -> None:
    for new, broad in NEW_MUSCLES.items():
        op.execute(f"UPDATE exercise SET muscle = '{broad}' WHERE muscle = '{new}'")
    op.drop_constraint("ck_exercise_muscle", "exercise", type_="check")
    op.create_check_constraint("ck_exercise_muscle", "exercise", _muscles(OLD_MUSCLES))
