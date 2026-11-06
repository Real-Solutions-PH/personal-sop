"""miss analysis

Revision ID: b8e3f1a6c2d4
Revises: e5b2c8a41d07
Create Date: 2026-11-06 20:15:00.000000

"""

import sqlalchemy as sa
import sqlmodel.sql.sqltypes
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = "b8e3f1a6c2d4"
down_revision = "e5b2c8a41d07"
branch_labels = None
depends_on = None


def upgrade():
    # Fern's analysis of one day's misses, cached per person per day so the
    # Yesterday page does not run the model on every open.
    op.create_table(
        "miss_analysis",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("owner_id", sa.Uuid(), nullable=False),
        sa.Column("tenant_id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("version", sa.BigInteger(), server_default="0", nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("day", sa.Date(), nullable=False),
        sa.Column(
            "fingerprint", sqlmodel.sql.sqltypes.AutoString(length=64), nullable=False
        ),
        sa.Column("points", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column(
            "model", sqlmodel.sql.sqltypes.AutoString(length=200), nullable=False
        ),
        sa.ForeignKeyConstraint(["owner_id"], ["user.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenant.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("owner_id", "day", name="uq_miss_analysis_day"),
    )
    op.create_index(
        op.f("ix_miss_analysis_deleted_at"),
        "miss_analysis",
        ["deleted_at"],
        unique=False,
    )
    op.create_index(
        op.f("ix_miss_analysis_owner_id"), "miss_analysis", ["owner_id"], unique=False
    )
    op.create_index(
        "ix_miss_analysis_owner_version",
        "miss_analysis",
        ["owner_id", "version"],
        unique=False,
    )
    op.create_index(
        op.f("ix_miss_analysis_tenant_id"), "miss_analysis", ["tenant_id"], unique=False
    )
    op.create_index(
        op.f("ix_miss_analysis_version"), "miss_analysis", ["version"], unique=False
    )
    op.execute(
        "CREATE TRIGGER miss_analysis_sync_version BEFORE INSERT OR UPDATE"
        " ON miss_analysis FOR EACH ROW EXECUTE FUNCTION set_sync_version()"
    )
    op.execute("ALTER TABLE miss_analysis ENABLE ROW LEVEL SECURITY")
    op.execute(
        """
        CREATE POLICY miss_analysis_tenant_isolation ON miss_analysis
            USING (tenant_id = app_tenant_id())
            WITH CHECK (tenant_id = app_tenant_id())
        """
    )


def downgrade():
    op.drop_table("miss_analysis")
