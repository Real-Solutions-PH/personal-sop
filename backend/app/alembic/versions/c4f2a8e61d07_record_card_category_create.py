"""record card category create kind

Revision ID: c4f2a8e61d07
Revises: 4d677e615a1f
Create Date: 2026-10-30 18:00:00.000000

"""

from alembic import op

# revision identifiers, used by Alembic.
revision = "c4f2a8e61d07"
down_revision = "4d677e615a1f"
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
    "edit",
    "remove",
)
NEW = ("categoryCreate",)


def _in(kinds: tuple[str, ...]) -> str:
    return "kind IN (" + ", ".join(f"'{k}'" for k in kinds) + ")"


def upgrade():
    # Fern adds a category or sub-category the person asks for, as an
    # undoable card.
    op.drop_constraint("ck_record_card_kind", "record_card", type_="check")
    op.create_check_constraint("ck_record_card_kind", "record_card", _in(KINDS + NEW))


def downgrade():
    # Those cards cannot satisfy the old constraint; they go (their write
    # log cascades). The categories they made stay.
    op.execute(f"DELETE FROM record_card WHERE {_in(NEW)}")
    op.drop_constraint("ck_record_card_kind", "record_card", type_="check")
    op.create_check_constraint("ck_record_card_kind", "record_card", _in(KINDS))
