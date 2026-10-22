"""record card edit and remove kinds

Revision ID: e5c1a7f3b920
Revises: d81c5f0a3b72
Create Date: 2026-10-22 20:00:00.000000

"""

from alembic import op

# revision identifiers, used by Alembic.
revision = "e5c1a7f3b920"
down_revision = "d81c5f0a3b72"
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
    "routineUpdate",
    "habitUpdate",
)
NEW = ("edit", "remove")


def _in(kinds: tuple[str, ...]) -> str:
    return "kind IN (" + ", ".join(f"'{k}'" for k in kinds) + ")"


def upgrade():
    # Fern changes or removes something the person already has (a
    # transaction, a scheduled payment, an account, a task...), as an
    # undoable card.
    op.drop_constraint("ck_record_card_kind", "record_card", type_="check")
    op.create_check_constraint("ck_record_card_kind", "record_card", _in(KINDS + NEW))


def downgrade():
    # Those cards cannot satisfy the old constraint; they go (their write
    # log cascades). The changes they made stay in their modules.
    op.execute(f"DELETE FROM record_card WHERE {_in(NEW)}")
    op.drop_constraint("ck_record_card_kind", "record_card", type_="check")
    op.create_check_constraint("ck_record_card_kind", "record_card", _in(KINDS))
