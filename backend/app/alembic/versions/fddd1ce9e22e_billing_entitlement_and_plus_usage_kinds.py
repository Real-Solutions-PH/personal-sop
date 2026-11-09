"""Billing: the account's plan (Unfurl Plus) as RevenueCat reports it, and
the Plus moments as usage events (ADR-0037).

Revision ID: fddd1ce9e22e
Revises: 2f24e6183b14
Create Date: 2026-11-09

"""

import sqlalchemy as sa
from alembic import op

revision = "fddd1ce9e22e"
down_revision = "2f24e6183b14"
branch_labels = None
depends_on = None

OLD_KINDS = "kind IN ('app_open', 'app_close', 'share_card')"
NEW_KINDS = (
    "kind IN ('app_open', 'app_close', 'share_card', 'paywall_shown',"
    " 'purchase_started', 'restored', 'purchased', 'cancelled', 'refunded')"
)
OLD_DETAIL = "(kind = 'share_card') = (detail IS NOT NULL)"
NEW_DETAIL = (
    "(kind <> 'share_card' OR detail IS NOT NULL)"
    " AND (kind NOT IN ('app_open', 'app_close') OR detail IS NULL)"
)


def upgrade() -> None:
    op.create_table(
        "entitlement",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("owner_id", sa.Uuid(), nullable=False),
        sa.Column("tenant_id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("version", sa.BigInteger(), server_default="0", nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("plan", sa.String(length=8), server_default="free", nullable=False),
        sa.Column("plus_until", sa.DateTime(timezone=True), nullable=True),
        sa.Column("will_renew", sa.Boolean(), server_default="false", nullable=False),
        sa.Column("product_id", sa.String(length=64), nullable=True),
        sa.Column("environment", sa.String(length=12), nullable=True),
        sa.Column("last_event_ms", sa.BigInteger(), nullable=True),
        sa.CheckConstraint(
            "environment IN ('sandbox', 'production')",
            name="ck_entitlement_environment",
        ),
        sa.CheckConstraint("plan IN ('free', 'plus')", name="ck_entitlement_plan"),
        sa.ForeignKeyConstraint(["owner_id"], ["user.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenant.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("owner_id", name="uq_entitlement_owner"),
    )
    for cols in (["deleted_at"], ["owner_id"], ["tenant_id"], ["version"]):
        op.create_index(op.f(f"ix_entitlement_{cols[0]}"), "entitlement", cols)
    op.create_index(
        "ix_entitlement_owner_version", "entitlement", ["owner_id", "version"]
    )
    op.execute(
        "CREATE TRIGGER entitlement_sync_version BEFORE INSERT OR UPDATE"
        " ON entitlement FOR EACH ROW EXECUTE FUNCTION set_sync_version()"
    )
    op.execute("ALTER TABLE entitlement ENABLE ROW LEVEL SECURITY")
    op.execute(
        """
        CREATE POLICY entitlement_tenant_isolation ON entitlement
            USING (tenant_id = app_tenant_id())
            WITH CHECK (tenant_id = app_tenant_id())
        """
    )

    op.alter_column(
        "usage_event",
        "kind",
        existing_type=sa.String(length=10),
        type_=sa.String(length=16),
        existing_nullable=False,
    )
    op.drop_constraint("ck_usage_event_kind", "usage_event", type_="check")
    op.create_check_constraint("ck_usage_event_kind", "usage_event", NEW_KINDS)
    op.drop_constraint("ck_usage_event_detail", "usage_event", type_="check")
    op.create_check_constraint("ck_usage_event_detail", "usage_event", NEW_DETAIL)


def downgrade() -> None:
    # The Plus kinds do not fit the old vocabulary: they go with it.
    op.execute(
        "DELETE FROM usage_event WHERE kind NOT IN"
        " ('app_open', 'app_close', 'share_card')"
    )
    op.drop_constraint("ck_usage_event_detail", "usage_event", type_="check")
    op.create_check_constraint("ck_usage_event_detail", "usage_event", OLD_DETAIL)
    op.drop_constraint("ck_usage_event_kind", "usage_event", type_="check")
    op.create_check_constraint("ck_usage_event_kind", "usage_event", OLD_KINDS)
    op.alter_column(
        "usage_event",
        "kind",
        existing_type=sa.String(length=16),
        type_=sa.String(length=10),
        existing_nullable=False,
    )
    op.drop_table("entitlement")
