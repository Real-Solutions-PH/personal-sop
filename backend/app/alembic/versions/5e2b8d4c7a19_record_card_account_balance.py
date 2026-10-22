"""record card account balance kind

Revision ID: 5e2b8d4c7a19
Revises: a3d6f2c41e87
Create Date: 2026-10-22 12:00:00.000000

"""

from alembic import op

# revision identifiers, used by Alembic.
revision = "5e2b8d4c7a19"
down_revision = "a3d6f2c41e87"
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
)
NEW = ("accountBalance",)


def _in(kinds: tuple[str, ...]) -> str:
    return "kind IN (" + ", ".join(f"'{k}'" for k in kinds) + ")"


def upgrade():
    # Fern sets the balance of an account that already exists, as an
    # undoable card.
    op.drop_constraint("ck_record_card_kind", "record_card", type_="check")
    op.create_check_constraint("ck_record_card_kind", "record_card", _in(KINDS + NEW))


def downgrade():
    # Those cards cannot satisfy the old constraint; they go (their write
    # log cascades). The balances they set stay in finance.
    op.execute(f"DELETE FROM record_card WHERE {_in(NEW)}")
    op.drop_constraint("ck_record_card_kind", "record_card", type_="check")
    op.create_check_constraint("ck_record_card_kind", "record_card", _in(KINDS))
