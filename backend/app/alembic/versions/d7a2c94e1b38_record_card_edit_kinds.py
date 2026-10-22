"""record card routine and habit edit kinds

Revision ID: d7a2c94e1b38
Revises: c3f81e2a9d57
Create Date: 2026-10-22 15:00:00.000000

"""

from alembic import op

# revision identifiers, used by Alembic.
revision = "d7a2c94e1b38"
down_revision = "c3f81e2a9d57"
branch_labels = None
depends_on = None


KINDS = (
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
    "accountCreate",
    "budgetCreate",
    "routineCreate",
    "templateCreate",
    "listCreate",
    "accountBalance",
)
NEW = ("routineUpdate", "habitUpdate")


def _in(kinds: tuple[str, ...]) -> str:
    return "kind IN (" + ", ".join(f"'{k}'" for k in kinds) + ")"


def upgrade():
    # Fern edits a routine or a habit the person already has, as an
    # undoable card.
    op.drop_constraint("ck_record_card_kind", "record_card", type_="check")
    op.create_check_constraint("ck_record_card_kind", "record_card", _in(KINDS + NEW))


def downgrade():
    # Those cards cannot satisfy the old constraint; they go (their write
    # log cascades). The edits they made stay in habits.
    op.execute(f"DELETE FROM record_card WHERE {_in(NEW)}")
    op.drop_constraint("ck_record_card_kind", "record_card", type_="check")
    op.create_check_constraint("ck_record_card_kind", "record_card", _in(KINDS))
