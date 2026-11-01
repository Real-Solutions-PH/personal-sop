"""Profile occupation and referral.

``user_profile`` gains sign-up's two "about you" answers: what the person
does (``occupation`` plus a free-text ``occupation_detail``) and how they
heard about the app (``referral_source`` plus ``referral_detail``). All four
are nullable and existing rows stay null; the two codes are checked against
their lists.

Revision ID: b40916735ea7
Revises: c4f2a8e61d07
Create Date: 2026-10-30

"""

import sqlalchemy as sa
from alembic import op

revision = "b40916735ea7"
down_revision = "c4f2a8e61d07"
branch_labels = None
depends_on = None

OCCUPATIONS = (
    "student",
    "employed",
    "self_employed",
    "business_owner",
    "between_jobs",
    "other",
)
REFERRAL_SOURCES = (
    "friend",
    "tiktok",
    "instagram",
    "facebook",
    "youtube",
    "app_store",
    "search",
    "other",
)


def _in(column: str, values: tuple[str, ...]) -> str:
    return f"{column} IN ({', '.join(repr(v) for v in values)})"


def upgrade() -> None:
    op.add_column("user_profile", sa.Column("occupation", sa.String(16)))
    op.add_column("user_profile", sa.Column("occupation_detail", sa.String(80)))
    op.add_column("user_profile", sa.Column("referral_source", sa.String(16)))
    op.add_column("user_profile", sa.Column("referral_detail", sa.String(80)))
    op.create_check_constraint(
        "ck_user_profile_occupation", "user_profile", _in("occupation", OCCUPATIONS)
    )
    op.create_check_constraint(
        "ck_user_profile_referral",
        "user_profile",
        _in("referral_source", REFERRAL_SOURCES),
    )


def downgrade() -> None:
    op.drop_constraint("ck_user_profile_referral", "user_profile", type_="check")
    op.drop_constraint("ck_user_profile_occupation", "user_profile", type_="check")
    op.drop_column("user_profile", "referral_detail")
    op.drop_column("user_profile", "referral_source")
    op.drop_column("user_profile", "occupation_detail")
    op.drop_column("user_profile", "occupation")
