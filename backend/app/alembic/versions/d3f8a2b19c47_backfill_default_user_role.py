"""backfill the baseline user role onto existing accounts

Every account provisioned from now on is granted the baseline ``user`` role at
provisioning time. This backfills that role onto accounts that predate the
change, so existing users retain access to their permission-gated resources
(items, OCR documents, conversations). Idempotent: a user that already holds
the role is skipped, and if the role has not been seeded yet the statement
matches nothing and is a no-op.

Revision ID: d3f8a2b19c47
Revises: df276405dedc
Create Date: 2026-09-04 00:00:00.000000

"""

from alembic import op

# revision identifiers, used by Alembic.
revision = "d3f8a2b19c47"
down_revision = "b952011f1fff"
branch_labels = None
depends_on = None


def upgrade():
    op.execute(
        """
        INSERT INTO user_role (user_id, role_id)
        SELECT u.id, r.id
        FROM "user" u
        CROSS JOIN role r
        WHERE r.name = 'user'
          AND NOT EXISTS (
              SELECT 1 FROM user_role ur
              WHERE ur.user_id = u.id AND ur.role_id = r.id
          )
        """
    )


def downgrade():
    # Deliberately a no-op: the grant is indistinguishable from one an operator
    # made through the API, so reversing it would revoke legitimately-held
    # roles. The forward migration is idempotent, so re-running upgrade is safe.
    pass
