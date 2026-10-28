"""Target adjustment: burned kcal (Apple Health) the user added to one day's
budget. One row per user and day; the versioned macro target is unchanged.

Revision ID: ed6795f25585
Revises: 958f09719229
Create Date: 2026-10-28

"""

import sqlalchemy as sa
from alembic import op

revision = "ed6795f25585"
down_revision = "958f09719229"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "target_adjustment",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("owner_id", sa.Uuid(), nullable=False),
        sa.Column("tenant_id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("version", sa.BigInteger(), server_default="0", nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("day", sa.Date(), nullable=False),
        sa.Column("kcal", sa.Float(), nullable=False),
        sa.Column("source", sa.String(length=8), nullable=False),
        sa.CheckConstraint("kcal >= 0", name="ck_target_adjustment_nonneg"),
        sa.ForeignKeyConstraint(["owner_id"], ["user.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenant.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("owner_id", "day", name="uq_target_adjustment_day"),
    )
    for cols in (["deleted_at"], ["owner_id"], ["tenant_id"], ["version"]):
        op.create_index(
            op.f(f"ix_target_adjustment_{cols[0]}"), "target_adjustment", cols
        )
    op.create_index(
        "ix_target_adjustment_owner_version",
        "target_adjustment",
        ["owner_id", "version"],
    )
    op.execute(
        "CREATE TRIGGER target_adjustment_sync_version BEFORE INSERT OR UPDATE"
        " ON target_adjustment FOR EACH ROW EXECUTE FUNCTION set_sync_version()"
    )
    op.execute("ALTER TABLE target_adjustment ENABLE ROW LEVEL SECURITY")
    op.execute(
        """
        CREATE POLICY target_adjustment_tenant_isolation ON target_adjustment
            USING (tenant_id = app_tenant_id())
            WITH CHECK (tenant_id = app_tenant_id())
        """
    )


def downgrade() -> None:
    op.drop_table("target_adjustment")
