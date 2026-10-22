"""fin record foreign currency

Revision ID: a65a6331fd8c
Revises: 5e2b8d4c7a19
Create Date: 2026-10-22 13:00:00.000000

"""

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "a65a6331fd8c"
down_revision = "5e2b8d4c7a19"
branch_labels = None
depends_on = None


def upgrade():
    # A record kept in another currency (a USD purchase): the amount as
    # spent and the rate it was converted at; amount_minor stays the
    # amount in the user's currency, so every total is unchanged.
    op.add_column("fin_record", sa.Column("orig_currency", sa.String(3)))
    op.add_column("fin_record", sa.Column("orig_amount_minor", sa.BigInteger()))
    op.add_column("fin_record", sa.Column("fx_rate", sa.Numeric(18, 8)))
    op.create_check_constraint(
        "ck_fin_record_fx_together",
        "fin_record",
        "(orig_currency IS NULL) = (orig_amount_minor IS NULL) "
        "AND (orig_currency IS NULL) = (fx_rate IS NULL)",
    )
    op.create_check_constraint(
        "ck_fin_record_orig_positive",
        "fin_record",
        "orig_amount_minor IS NULL OR orig_amount_minor > 0",
    )
    op.create_check_constraint(
        "ck_fin_record_fx_rate", "fin_record", "fx_rate IS NULL OR fx_rate > 0"
    )


def downgrade():
    # The converted amount stays; the original currency is forgotten.
    op.drop_constraint("ck_fin_record_fx_rate", "fin_record", type_="check")
    op.drop_constraint("ck_fin_record_orig_positive", "fin_record", type_="check")
    op.drop_constraint("ck_fin_record_fx_together", "fin_record", type_="check")
    op.drop_column("fin_record", "fx_rate")
    op.drop_column("fin_record", "orig_amount_minor")
    op.drop_column("fin_record", "orig_currency")
