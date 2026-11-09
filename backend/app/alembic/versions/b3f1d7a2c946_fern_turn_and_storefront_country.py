"""Fern allowance: one ``fern_turn`` row per Fern message answered on the
server's key (what the free daily allowance and the Plus fair-use limit
count), and the App Store storefront country on the profile (the price tier).

Revision ID: b3f1d7a2c946
Revises: 0ebdc219ab8e
Create Date: 2026-11-09

"""

import sqlalchemy as sa
from alembic import op

revision = "b3f1d7a2c946"
down_revision = "0ebdc219ab8e"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "fern_turn",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("owner_id", sa.Uuid(), nullable=False),
        sa.Column("tenant_id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("version", sa.BigInteger(), server_default="0", nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("message_id", sa.Uuid(), nullable=False),
        sa.Column("plan", sa.String(length=5), nullable=False),
        sa.Column("light", sa.Boolean(), nullable=False),
        sa.CheckConstraint("plan IN ('free', 'plus')", name="ck_fern_turn_plan"),
        sa.ForeignKeyConstraint(["owner_id"], ["user.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenant.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("owner_id", "message_id", name="uq_fern_turn_message"),
    )
    for cols in (["at"], ["deleted_at"], ["owner_id"], ["tenant_id"], ["version"]):
        op.create_index(op.f(f"ix_fern_turn_{cols[0]}"), "fern_turn", cols)
    op.create_index("ix_fern_turn_owner_version", "fern_turn", ["owner_id", "version"])
    op.execute(
        "CREATE TRIGGER fern_turn_sync_version BEFORE INSERT OR UPDATE"
        " ON fern_turn FOR EACH ROW EXECUTE FUNCTION set_sync_version()"
    )
    op.execute("ALTER TABLE fern_turn ENABLE ROW LEVEL SECURITY")
    op.execute(
        """
        CREATE POLICY fern_turn_tenant_isolation ON fern_turn
            USING (tenant_id = app_tenant_id())
            WITH CHECK (tenant_id = app_tenant_id())
        """
    )
    op.add_column(
        "user_profile",
        sa.Column("storefront_country", sa.String(length=2), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("user_profile", "storefront_country")
    op.drop_table("fern_turn")
