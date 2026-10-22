"""Companion threads: separate chats with Fern.

Revision ID: b8d2f4a6c913
Revises: a3c7e91d5b20
Create Date: 2026-10-23

"""

import sqlalchemy as sa
import sqlmodel.sql.sqltypes
from alembic import op

revision = "b8d2f4a6c913"
down_revision = "a3c7e91d5b20"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "companion_thread",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("owner_id", sa.Uuid(), nullable=False),
        sa.Column("tenant_id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("version", sa.BigInteger(), server_default="0", nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("title", sqlmodel.sql.sqltypes.AutoString(length=80), nullable=True),
        sa.Column("last_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "summary", sqlmodel.sql.sqltypes.AutoString(length=2000), nullable=True
        ),
        sa.Column("summary_through", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["owner_id"], ["user.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenant.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    for col in ("deleted_at", "owner_id", "tenant_id", "version", "last_at"):
        op.create_index(
            op.f(f"ix_companion_thread_{col}"), "companion_thread", [col], unique=False
        )
    op.create_index(
        "ix_companion_thread_owner_version",
        "companion_thread",
        ["owner_id", "version"],
        unique=False,
    )
    op.execute(
        "CREATE TRIGGER companion_thread_sync_version BEFORE INSERT OR UPDATE"
        " ON companion_thread FOR EACH ROW EXECUTE FUNCTION set_sync_version()"
    )
    op.execute("ALTER TABLE companion_thread ENABLE ROW LEVEL SECURITY")
    op.execute(
        """
        CREATE POLICY companion_thread_tenant_isolation ON companion_thread
            USING (tenant_id = app_tenant_id())
            WITH CHECK (tenant_id = app_tenant_id())
        """
    )

    op.add_column("companion_message", sa.Column("thread_id", sa.Uuid(), nullable=True))
    op.create_index(
        op.f("ix_companion_message_thread_id"),
        "companion_message",
        ["thread_id"],
        unique=False,
    )
    op.create_foreign_key(
        "companion_message_thread_id_fkey",
        "companion_message",
        "companion_thread",
        ["thread_id"],
        ["id"],
        ondelete="CASCADE",
    )
    # Everything said so far becomes one chat per person, carrying the
    # running summary the companion row kept.
    op.execute(
        """
        INSERT INTO companion_thread
            (id, owner_id, tenant_id, created_at, updated_at, title, last_at,
             summary, summary_through)
        SELECT gen_random_uuid(), m.owner_id, m.tenant_id, min(m.created_at),
               now(), 'Earlier chats', max(m.created_at),
               c.summary, c.summary_through
        FROM companion_message m
        LEFT JOIN companion c ON c.owner_id = m.owner_id
        GROUP BY m.owner_id, m.tenant_id, c.summary, c.summary_through
        """
    )
    op.execute(
        """
        UPDATE companion_message m SET thread_id = t.id
        FROM companion_thread t WHERE t.owner_id = m.owner_id
        """
    )


def downgrade() -> None:
    op.drop_constraint(
        "companion_message_thread_id_fkey", "companion_message", type_="foreignkey"
    )
    op.drop_index(op.f("ix_companion_message_thread_id"), table_name="companion_message")
    op.drop_column("companion_message", "thread_id")
    op.drop_table("companion_thread")
