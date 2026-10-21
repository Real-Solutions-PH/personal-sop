"""User profile: the user's currency (ISO 4217 code).

Every existing profile gets PHP through the server default, so nobody's
amounts change label. The CHECK lists the codes in app.shared.currency at the
time of this revision (a snapshot: adding a currency is a new revision).

Revision ID: 466bdf099326
Revises: 2bc76ea88d36
Create Date: 2026-10-21 12:00:00.000000

"""

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "466bdf099326"
down_revision = "2bc76ea88d36"
branch_labels = None
depends_on = None

CODES = ('PHP', 'USD', 'EUR', 'GBP', 'JPY', 'CNY', 'KRW', 'INR', 'IDR', 'MYR', 'SGD', 'THB', 'VND', 'HKD', 'TWD', 'AUD', 'NZD', 'CAD', 'MXN', 'BRL', 'CHF', 'SEK', 'NOK', 'DKK', 'PLN', 'ZAR', 'AED', 'SAR', 'TRY', 'NGN', 'KES', 'EGP', 'ILS', 'CZK', 'HUF', 'PKR', 'BDT', 'COP', 'CLP', 'PEN')


def upgrade() -> None:
    op.add_column(
        "user_profile",
        sa.Column("currency", sa.String(3), nullable=False, server_default="PHP"),
    )
    quoted = ", ".join(f"'{c}'" for c in CODES)
    op.create_check_constraint(
        "ck_user_profile_currency", "user_profile", f"currency IN ({quoted})"
    )


def downgrade() -> None:
    op.drop_constraint("ck_user_profile_currency", "user_profile", type_="check")
    op.drop_column("user_profile", "currency")
