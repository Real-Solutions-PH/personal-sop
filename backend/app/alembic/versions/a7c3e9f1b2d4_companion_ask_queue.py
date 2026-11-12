"""companion_ask: Fern's server-side message queue.

Every message the app sends to Fern is kept here, keyed by its own id,
until it is answered on the server (``app.modules.companion.queue``). A new
table: no backfill (messages from before it were answered the old way).
Not synced to devices, so no sync-version trigger; tenant-isolated by RLS
like every owned table.

Revision ID: a7c3e9f1b2d4
Revises: b7d2e4f6a813
Create Date: 2026-11-12 09:30:00.000000

"""

import sqlalchemy as sa
import sqlmodel.sql.sqltypes
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = "a7c3e9f1b2d4"
down_revision = "b7d2e4f6a813"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "companion_ask",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("owner_id", sa.Uuid(), nullable=False),
        sa.Column("tenant_id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("version", sa.BigInteger(), server_default="0", nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("thread_id", sa.Uuid(), nullable=True),
        sa.Column(
            "text", sqlmodel.sql.sqltypes.AutoString(length=4000), nullable=False
        ),
        sa.Column(
            "media_ids",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'[]'::jsonb"),
            nullable=False,
        ),
        sa.Column(
            "status", sa.String(length=8), server_default="queued", nullable=False
        ),
        sa.Column("attempts", sa.SmallInteger(), server_default="0", nullable=False),
        sa.Column("wrote", sa.Boolean(), server_default="false", nullable=False),
        sa.Column(
            "error", sqlmodel.sql.sqltypes.AutoString(length=40), nullable=True
        ),
        sa.Column("not_before", sa.DateTime(timezone=True), nullable=True),
        sa.Column("lease_until", sa.DateTime(timezone=True), nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "status IN ('queued', 'running', 'done', 'failed')",
            name="ck_companion_ask_status",
        ),
        sa.CheckConstraint("attempts >= 0", name="ck_companion_ask_attempts"),
        sa.ForeignKeyConstraint(["owner_id"], ["user.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenant.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    for col in ("deleted_at", "owner_id", "tenant_id", "version"):
        op.create_index(
            op.f(f"ix_companion_ask_{col}"), "companion_ask", [col], unique=False
        )
    op.create_index(
        "ix_companion_ask_owner_version",
        "companion_ask",
        ["owner_id", "version"],
        unique=False,
    )
    op.create_index(
        "ix_companion_ask_owner_status",
        "companion_ask",
        ["owner_id", "status", "created_at"],
        unique=False,
    )
    op.create_index(
        "ix_companion_ask_open",
        "companion_ask",
        ["status"],
        unique=False,
        postgresql_where=sa.text("status IN ('queued', 'running')"),
    )
    op.execute("ALTER TABLE companion_ask ENABLE ROW LEVEL SECURITY")
    op.execute(
        """
        CREATE POLICY companion_ask_tenant_isolation ON companion_ask
            USING (tenant_id = app_tenant_id())
            WITH CHECK (tenant_id = app_tenant_id())
        """
    )


def downgrade() -> None:
    op.drop_table("companion_ask")
