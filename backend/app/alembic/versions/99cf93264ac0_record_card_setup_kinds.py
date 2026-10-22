"""record card setup kinds

Revision ID: 99cf93264ac0
Revises: 53e98a285909
Create Date: 2026-10-22 12:00:00.000000

"""

from alembic import op

# revision identifiers, used by Alembic.
revision = "99cf93264ac0"
down_revision = "53e98a285909"
branch_labels = None
depends_on = None


OLD_KINDS = (
    "expense",
    "income",
    "transfer",
    "planned",
    "task",
    "taskComplete",
    "habitLog",
    "habitCreate",
    "routineStart",
    "workout",
    "weighIn",
    "meal",
    "journal",
    "photo",
    "command",
)
SETUP_KINDS = (
    "accountCreate",
    "budgetCreate",
    "routineCreate",
    "templateCreate",
    "listCreate",
)


def _in(kinds: tuple[str, ...]) -> str:
    return "kind IN (" + ", ".join(f"'{k}'" for k in kinds) + ")"


def upgrade():
    # Fern sets things up by chat: an account, a budget, a routine, a workout
    # template, a task list, each as an undoable card.
    op.drop_constraint("ck_record_card_kind", "record_card", type_="check")
    op.create_check_constraint(
        "ck_record_card_kind", "record_card", _in(OLD_KINDS + SETUP_KINDS)
    )


def downgrade():
    # Setup cards cannot satisfy the old constraint; they go (their write
    # log cascades). What they created stays in its module.
    op.execute(f"DELETE FROM record_card WHERE {_in(SETUP_KINDS)}")
    op.drop_constraint("ck_record_card_kind", "record_card", type_="check")
    op.create_check_constraint("ck_record_card_kind", "record_card", _in(OLD_KINDS))
