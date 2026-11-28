"""joint finance accounts and invite links

Revision ID: d4742446dec4
Revises: a3c5e7f9b1d2
Create Date: 2026-11-28 10:00:00.000000

- ``invite``: one row per invite link, for any kind of shareable thing
  (``kind`` + ``object_id``). The token is stored only as its SHA-256
  (``token_hash``, unique). Sync-version trigger and the tenant row-level
  security policy every owned table has.
- ``fin_record.logged_by``: on a joint account, the member who logged a
  record into the owner's ledger (NULL for the owner's own records).
- ``shared_member``, ``shared_membership`` and ``shared_event`` admit the
  kind ``account``; ``shared_event`` admits ``invited``, ``left``,
  ``removed`` and ``recorded``.

The way down deletes the account memberships, views and events, puts the
CHECKs back, drops the column and the table.
"""

import sqlalchemy as sa
from alembic import op

revision = "d4742446dec4"
down_revision = "a3c5e7f9b1d2"
branch_labels = None
depends_on = None

OLD_EVENT_KINDS = (
    "created",
    "joined",
    "declined",
    "deposited",
    "withdrawal_sent",
    "withdrawal_accepted",
    "withdrawal_rejected",
    "withdrawal_withdrawn",
    "categories_set",
    "threshold",
)
NEW_EVENT_KINDS = (*OLD_EVENT_KINDS, "invited", "left", "removed", "recorded")


def _in(column: str, values: tuple[str, ...]) -> str:
    return f"{column} IN ({', '.join(repr(v) for v in values)})"


def _check(name: str, table: str, sql: str) -> None:
    op.drop_constraint(name, table, type_="check")
    op.create_check_constraint(name, table, sql)


def upgrade() -> None:
    op.create_table(
        "invite",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("owner_id", sa.Uuid(), nullable=False),
        sa.Column("tenant_id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("version", sa.BigInteger(), server_default="0", nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("kind", sa.String(length=24), nullable=False),
        sa.Column("object_id", sa.Uuid(), nullable=False),
        sa.Column("token_hash", sa.String(length=64), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("used_by", sa.Uuid(), nullable=True),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "(used_at IS NULL) = (used_by IS NULL)", name="ck_invite_used_together"
        ),
        sa.CheckConstraint("expires_at > created_at", name="ck_invite_expiry"),
        sa.ForeignKeyConstraint(["owner_id"], ["user.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenant.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["used_by"], ["user.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("token_hash", name="uq_invite_token_hash"),
    )
    for col in ("deleted_at", "owner_id", "tenant_id", "version"):
        op.create_index(op.f(f"ix_invite_{col}"), "invite", [col], unique=False)
    op.create_index(
        "ix_invite_owner_version", "invite", ["owner_id", "version"], unique=False
    )
    op.create_index("ix_invite_object", "invite", ["kind", "object_id"], unique=False)
    op.execute(
        "CREATE TRIGGER invite_sync_version BEFORE INSERT OR UPDATE"
        " ON invite FOR EACH ROW EXECUTE FUNCTION set_sync_version()"
    )
    op.execute("ALTER TABLE invite ENABLE ROW LEVEL SECURITY")
    op.execute(
        """
        CREATE POLICY invite_tenant_isolation ON invite
            USING (tenant_id = app_tenant_id())
            WITH CHECK (tenant_id = app_tenant_id())
        """
    )

    op.add_column("fin_record", sa.Column("logged_by", sa.Uuid(), nullable=True))
    op.create_foreign_key(
        "fin_record_logged_by_fkey",
        "fin_record",
        "user",
        ["logged_by"],
        ["id"],
        ondelete="SET NULL",
    )

    _check(
        "ck_shared_member_kind",
        "shared_member",
        "kind IN ('loan', 'goal', 'budget', 'account')",
    )
    _check(
        "ck_shared_membership_kind",
        "shared_membership",
        "kind IN ('goal', 'budget', 'account')",
    )
    _check(
        "ck_shared_event_object_kind",
        "shared_event",
        "object_kind IN ('goal', 'budget', 'account')",
    )
    _check("ck_shared_event_kind", "shared_event", _in("kind", NEW_EVENT_KINDS))


def downgrade() -> None:
    op.execute("DELETE FROM shared_member WHERE kind = 'account'")
    op.execute("DELETE FROM shared_membership WHERE kind = 'account'")
    # The trail is append-only (UPDATE refused); DELETE is allowed.
    op.execute("DELETE FROM shared_event WHERE object_kind = 'account'")
    op.execute(
        "DELETE FROM shared_event WHERE kind IN"
        " ('invited', 'left', 'removed', 'recorded')"
    )
    _check("ck_shared_event_kind", "shared_event", _in("kind", OLD_EVENT_KINDS))
    _check(
        "ck_shared_event_object_kind",
        "shared_event",
        "object_kind IN ('goal', 'budget')",
    )
    _check(
        "ck_shared_membership_kind",
        "shared_membership",
        "kind IN ('goal', 'budget')",
    )
    _check(
        "ck_shared_member_kind",
        "shared_member",
        "kind IN ('loan', 'goal', 'budget')",
    )
    op.drop_constraint("fin_record_logged_by_fkey", "fin_record", type_="foreignkey")
    op.drop_column("fin_record", "logged_by")
    op.drop_table("invite")
