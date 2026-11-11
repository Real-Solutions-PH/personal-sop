"""Schedule override: a habit, routine or recurring task's occurrence moved
to another time on one day from the Plan tab. The item's own schedule is
unchanged; reset is a tombstone.

Revision ID: b7d2e4f6a813
Revises: e9af4348ea3f
Create Date: 2026-11-12

"""

import sqlalchemy as sa
from alembic import op

revision = "b7d2e4f6a813"
down_revision = "e9af4348ea3f"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "schedule_override",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("owner_id", sa.Uuid(), nullable=False),
        sa.Column("tenant_id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("version", sa.BigInteger(), server_default="0", nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("kind", sa.String(length=8), nullable=False),
        sa.Column("ref_id", sa.Uuid(), nullable=False),
        sa.Column("day", sa.Date(), nullable=False),
        sa.Column("time", sa.String(length=5), nullable=False),
        sa.CheckConstraint(
            "kind IN ('habit', 'routine', 'task')", name="ck_schedule_override_kind"
        ),
        sa.ForeignKeyConstraint(["owner_id"], ["user.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenant.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "owner_id", "kind", "ref_id", "day", name="uq_schedule_override_item_day"
        ),
    )
    for name in ("deleted_at", "owner_id", "tenant_id", "version", "ref_id"):
        op.create_index(
            op.f(f"ix_schedule_override_{name}"), "schedule_override", [name]
        )
    op.create_index(
        "ix_schedule_override_owner_version",
        "schedule_override",
        ["owner_id", "version"],
    )
    op.execute(
        "CREATE TRIGGER schedule_override_sync_version BEFORE INSERT OR UPDATE"
        " ON schedule_override FOR EACH ROW EXECUTE FUNCTION set_sync_version()"
    )
    op.execute("ALTER TABLE schedule_override ENABLE ROW LEVEL SECURITY")
    op.execute(
        """
        CREATE POLICY schedule_override_tenant_isolation ON schedule_override
            USING (tenant_id = app_tenant_id())
            WITH CHECK (tenant_id = app_tenant_id())
        """
    )


def downgrade() -> None:
    op.drop_table("schedule_override")
