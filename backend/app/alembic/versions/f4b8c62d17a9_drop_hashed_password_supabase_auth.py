"""Drop user.hashed_password — credentials live in Supabase Auth

The backend no longer stores or verifies passwords: authentication is a
Supabase-issued JWT verified against the project JWKS, and the local
``user`` row is a mirror keyed by the Supabase auth UID. The downgrade
restores the column with a sentinel value (original hashes are gone).

Revision ID: f4b8c62d17a9
Revises: c8f2a1d47e56
Create Date: 2026-07-12 00:00:00.000000

"""
import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = 'f4b8c62d17a9'
down_revision = 'c8f2a1d47e56'
branch_labels = None
depends_on = None


def upgrade():
    op.drop_column('user', 'hashed_password')


def downgrade():
    # Hashes are unrecoverable; backfill an invalid sentinel so NOT NULL
    # holds. Affected users must reset their password out-of-band.
    op.add_column(
        'user',
        sa.Column(
            'hashed_password',
            sa.String(),
            nullable=False,
            server_default='!supabase-migrated',
        ),
    )
    op.alter_column('user', 'hashed_password', server_default=None)
