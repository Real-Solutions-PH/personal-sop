"""food library

Revision ID: f2a8c4d6e1b7
Revises: e5c1a7f3b920
Create Date: 2026-10-22 22:35:37.433134

"""

import sqlalchemy as sa
import sqlmodel.sql.sqltypes
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = "f2a8c4d6e1b7"
down_revision = "e5c1a7f3b920"
branch_labels = None
depends_on = None


def upgrade():
    # The person's own food library: nutrition read from a label, said in
    # chat, or imported, which meal logging uses before any estimate.
    op.create_table(
        "food_item",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("owner_id", sa.Uuid(), nullable=False),
        sa.Column("tenant_id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("version", sa.BigInteger(), server_default="0", nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("name", sqlmodel.sql.sqltypes.AutoString(length=160), nullable=False),
        sa.Column("key", sqlmodel.sql.sqltypes.AutoString(length=160), nullable=False),
        sa.Column("aliases", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("basis", sa.String(length=8), nullable=False),
        sa.Column("unit_grams", sa.Float(), nullable=True),
        sa.Column("state", sa.String(length=8), nullable=True),
        sa.Column("kcal", sa.Float(), nullable=False),
        sa.Column("protein", sa.Float(), nullable=False),
        sa.Column("carbs", sa.Float(), nullable=False),
        sa.Column("fat", sa.Float(), nullable=False),
        sa.Column("fiber", sa.Float(), nullable=True),
        sa.Column("sat_fat", sa.Float(), nullable=True),
        sa.Column("sugar", sa.Float(), nullable=True),
        sa.Column("sodium", sa.Float(), nullable=True),
        sa.Column("source", sa.String(length=8), nullable=False),
        sa.Column(
            "source_url", sqlmodel.sql.sqltypes.AutoString(length=500), nullable=True
        ),
        sa.Column(
            "external_ref", sqlmodel.sql.sqltypes.AutoString(length=200), nullable=True
        ),
        sa.Column("notes", sqlmodel.sql.sqltypes.AutoString(length=500), nullable=True),
        sa.Column("verified", sa.Boolean(), nullable=False),
        sa.Column("use_count", sa.Integer(), nullable=False),
        sa.Column("last_used_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "basis IN ('100g', 'piece', 'serving')", name="ck_food_item_basis"
        ),
        sa.CheckConstraint(
            "source IN ('label', 'brand', 'philfct', 'usda', 'recipe', 'said', 'import')",
            name="ck_food_item_source",
        ),
        sa.CheckConstraint(
            "state IS NULL OR state IN ('raw', 'cooked', 'as_sold')",
            name="ck_food_item_state",
        ),
        sa.CheckConstraint(
            "(fiber IS NULL OR fiber >= 0) AND (sat_fat IS NULL OR sat_fat >= 0) AND (sugar IS NULL OR sugar >= 0) AND (sodium IS NULL OR sodium >= 0)",
            name="ck_food_item_detail_nonneg",
        ),
        sa.CheckConstraint(
            "kcal >= 0 AND protein >= 0 AND carbs >= 0 AND fat >= 0",
            name="ck_food_item_nonneg",
        ),
        sa.CheckConstraint(
            "unit_grams IS NULL OR unit_grams > 0", name="ck_food_item_unit_grams"
        ),
        sa.ForeignKeyConstraint(["owner_id"], ["user.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenant.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("owner_id", "key", name="uq_food_item_owner_key"),
    )
    op.create_index(
        op.f("ix_food_item_deleted_at"), "food_item", ["deleted_at"], unique=False
    )
    op.create_index(
        op.f("ix_food_item_owner_id"), "food_item", ["owner_id"], unique=False
    )
    op.create_index(
        "ix_food_item_owner_version", "food_item", ["owner_id", "version"], unique=False
    )
    op.create_index(
        op.f("ix_food_item_tenant_id"), "food_item", ["tenant_id"], unique=False
    )
    op.create_index(
        op.f("ix_food_item_version"), "food_item", ["version"], unique=False
    )
    op.execute(
        "CREATE TRIGGER food_item_sync_version BEFORE INSERT OR UPDATE"
        " ON food_item FOR EACH ROW EXECUTE FUNCTION set_sync_version()"
    )
    op.execute("ALTER TABLE food_item ENABLE ROW LEVEL SECURITY")
    op.execute(
        """
        CREATE POLICY food_item_tenant_isolation ON food_item
            USING (tenant_id = app_tenant_id())
            WITH CHECK (tenant_id = app_tenant_id())
        """
    )


def downgrade():
    op.drop_table("food_item")
