"""Usage events: app opens and closes and shared cards, per person, so app
opens, time in app and share cards can be measured (docs/25-retention-kpis.md).

Revision ID: 6d208ffac40f
Revises: b8e3f1a6c2d4
Create Date: 2026-11-08

"""

import sqlalchemy as sa
from alembic import op

revision = "6d208ffac40f"
down_revision = "b8e3f1a6c2d4"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "usage_event",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("owner_id", sa.Uuid(), nullable=False),
        sa.Column("tenant_id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("version", sa.BigInteger(), server_default="0", nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("kind", sa.String(length=10), nullable=False),
        sa.Column("at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("detail", sa.String(length=40), nullable=True),
        sa.CheckConstraint(
            "(kind = 'share_card') = (detail IS NOT NULL)",
            name="ck_usage_event_detail",
        ),
        sa.CheckConstraint(
            "kind IN ('app_open', 'app_close', 'share_card')",
            name="ck_usage_event_kind",
        ),
        sa.ForeignKeyConstraint(["owner_id"], ["user.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenant.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    for cols in (["deleted_at"], ["owner_id"], ["tenant_id"], ["version"]):
        op.create_index(op.f(f"ix_usage_event_{cols[0]}"), "usage_event", cols)
    op.create_index(
        "ix_usage_event_owner_version", "usage_event", ["owner_id", "version"]
    )
    op.create_index("ix_usage_event_owner_at", "usage_event", ["owner_id", "at"])
    op.execute(
        "CREATE TRIGGER usage_event_sync_version BEFORE INSERT OR UPDATE"
        " ON usage_event FOR EACH ROW EXECUTE FUNCTION set_sync_version()"
    )
    op.execute("ALTER TABLE usage_event ENABLE ROW LEVEL SECURITY")
    op.execute(
        """
        CREATE POLICY usage_event_tenant_isolation ON usage_event
            USING (tenant_id = app_tenant_id())
            WITH CHECK (tenant_id = app_tenant_id())
        """
    )


def downgrade() -> None:
    op.drop_table("usage_event")
