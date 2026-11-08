"""way back: daily check-in time and Fern review cache

Revision ID: 2f24e6183b14
Revises: 6d208ffac40f
Create Date: 2026-11-08 18:00:00.000000

"""

import sqlalchemy as sa
import sqlmodel.sql.sqltypes
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = "2f24e6183b14"
down_revision = "6d208ffac40f"
branch_labels = None
depends_on = None


def upgrade():
    # The daily Fern check-in time (HH:MM); NULL means off.
    op.add_column(
        "user_profile",
        sa.Column(
            "push_checkin", sqlmodel.sql.sqltypes.AutoString(length=5), nullable=True
        ),
    )
    # Fern's wins-first review of a range, cached per person per range so
    # reopening it does not run the model again.
    op.create_table(
        "fern_review",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("owner_id", sa.Uuid(), nullable=False),
        sa.Column("tenant_id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("version", sa.BigInteger(), server_default="0", nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("kind", sqlmodel.sql.sqltypes.AutoString(length=16), nullable=False),
        sa.Column("from_day", sa.Date(), nullable=False),
        sa.Column("to_day", sa.Date(), nullable=False),
        sa.Column(
            "fingerprint", sqlmodel.sql.sqltypes.AutoString(length=64), nullable=False
        ),
        sa.Column("body", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column(
            "model", sqlmodel.sql.sqltypes.AutoString(length=200), nullable=False
        ),
        sa.CheckConstraint(
            "kind IN ('way_back', 'weekly')", name="ck_fern_review_kind"
        ),
        sa.ForeignKeyConstraint(["owner_id"], ["user.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenant.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "owner_id", "kind", "from_day", "to_day", name="uq_fern_review_range"
        ),
    )
    op.create_index(
        op.f("ix_fern_review_deleted_at"), "fern_review", ["deleted_at"], unique=False
    )
    op.create_index(
        op.f("ix_fern_review_owner_id"), "fern_review", ["owner_id"], unique=False
    )
    op.create_index(
        "ix_fern_review_owner_version",
        "fern_review",
        ["owner_id", "version"],
        unique=False,
    )
    op.create_index(
        op.f("ix_fern_review_tenant_id"), "fern_review", ["tenant_id"], unique=False
    )
    op.create_index(
        op.f("ix_fern_review_version"), "fern_review", ["version"], unique=False
    )
    op.execute(
        "CREATE TRIGGER fern_review_sync_version BEFORE INSERT OR UPDATE"
        " ON fern_review FOR EACH ROW EXECUTE FUNCTION set_sync_version()"
    )
    op.execute("ALTER TABLE fern_review ENABLE ROW LEVEL SECURITY")
    op.execute(
        """
        CREATE POLICY fern_review_tenant_isolation ON fern_review
            USING (tenant_id = app_tenant_id())
            WITH CHECK (tenant_id = app_tenant_id())
        """
    )


def downgrade():
    op.drop_table("fern_review")
    op.drop_column("user_profile", "push_checkin")
