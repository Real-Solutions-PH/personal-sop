"""Retention Slice 1: the nightly retention profile, one row per engagement
nudge decision, and the person's nudge settings
(docs/26-retention-algorithms.md §4.2), and ``push_open`` usage events.

Revision ID: 5cf0aa4a327d
Revises: e9af4348ea3f
Create Date: 2026-11-12

"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "5cf0aa4a327d"
down_revision = "e9af4348ea3f"
branch_labels = None
depends_on = None


OLD_KINDS = (
    "kind IN ('app_open', 'app_close', 'share_card', 'paywall_shown',"
    " 'purchase_started', 'restored', 'purchased', 'cancelled', 'refunded')"
)
NEW_KINDS = (
    "kind IN ('app_open', 'app_close', 'share_card', 'paywall_shown',"
    " 'purchase_started', 'restored', 'push_open', 'purchased', 'cancelled',"
    " 'refunded')"
)
OLD_DETAIL = (
    "(kind <> 'share_card' OR detail IS NOT NULL)"
    " AND (kind NOT IN ('app_open', 'app_close') OR detail IS NULL)"
)
NEW_DETAIL = (
    "(kind NOT IN ('share_card', 'push_open') OR detail IS NOT NULL)"
    " AND (kind NOT IN ('app_open', 'app_close') OR detail IS NULL)"
)


def _owned(table: str) -> None:
    """Indexes, the sync-version trigger and the tenant policy every owned
    table carries."""
    for col in ("deleted_at", "owner_id", "tenant_id", "version"):
        op.create_index(f"ix_{table}_{col}", table, [col])
    op.create_index(f"ix_{table}_owner_version", table, ["owner_id", "version"])
    op.execute(
        f"CREATE TRIGGER {table}_sync_version BEFORE INSERT OR UPDATE"
        f" ON {table} FOR EACH ROW EXECUTE FUNCTION set_sync_version()"
    )
    op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
    op.execute(
        f"""
        CREATE POLICY {table}_tenant_isolation ON {table}
            USING (tenant_id = app_tenant_id())
            WITH CHECK (tenant_id = app_tenant_id())
        """
    )


def upgrade() -> None:
    op.create_table(
        "retention_profile",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("owner_id", sa.Uuid(), nullable=False),
        sa.Column("tenant_id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("version", sa.BigInteger(), server_default="0", nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("archetype", sa.String(length=16), nullable=True),
        sa.Column("secondary", sa.String(length=16), nullable=True),
        sa.Column("tags", postgresql.JSONB(), nullable=False),
        sa.Column("stage", sa.String(length=10), nullable=False),
        sa.Column("risk", sa.Integer(), nullable=False),
        sa.Column("last_log_day", sa.Date(), nullable=True),
        sa.Column("log_days_total", sa.Integer(), nullable=False),
        sa.Column("slot_hist", postgresql.JSONB(), nullable=False),
        sa.Column("best_slot_weekday", sa.Integer(), nullable=True),
        sa.Column("best_slot_weekend", sa.Integer(), nullable=True),
        sa.Column("ignore_streak", sa.Integer(), nullable=False),
        sa.Column("next_nudge_after", sa.Date(), nullable=True),
        sa.Column("ladder_step", sa.Integer(), nullable=False),
        sa.Column("goal_q", sa.Float(), nullable=True),
        sa.Column("arm", sa.String(length=16), nullable=False),
        sa.Column("computed_day", sa.Date(), nullable=True),
        sa.CheckConstraint(
            "arm IN ('holdout', 'treated')", name="ck_retention_profile_arm"
        ),
        sa.CheckConstraint(
            "stage IN ('new', 'lapsed', 'lapsing', 'returning', 'steady', 'drifting')",
            name="ck_retention_profile_stage",
        ),
        sa.CheckConstraint(
            "best_slot_weekday IS NULL OR best_slot_weekday BETWEEN 0 AND 47",
            name="ck_retention_profile_slot_weekday",
        ),
        sa.CheckConstraint(
            "best_slot_weekend IS NULL OR best_slot_weekend BETWEEN 0 AND 47",
            name="ck_retention_profile_slot_weekend",
        ),
        sa.CheckConstraint("risk BETWEEN 0 AND 100", name="ck_retention_profile_risk"),
        sa.ForeignKeyConstraint(["owner_id"], ["user.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenant.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("owner_id", name="uq_retention_profile_owner"),
    )
    _owned("retention_profile")

    op.create_table(
        "nudge",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("owner_id", sa.Uuid(), nullable=False),
        sa.Column("tenant_id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("version", sa.BigInteger(), server_default="0", nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("day", sa.Date(), nullable=False),
        sa.Column("kind", sa.String(length=16), nullable=False),
        sa.Column("scheduled_for", sa.DateTime(timezone=True), nullable=False),
        sa.Column("sent_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("opened_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("suppressed", sa.String(length=16), nullable=True),
        sa.Column("arm", sa.String(length=16), nullable=False),
        sa.Column("notification_id", sa.Uuid(), nullable=True),
        sa.Column("dedupe_key", sa.String(length=40), nullable=False),
        sa.CheckConstraint("arm IN ('holdout', 'treated')", name="ck_nudge_arm"),
        sa.CheckConstraint(
            "kind IN ('best_time', 'ladder_3', 'ladder_7', 'ladder_14', 'ladder_30')",
            name="ck_nudge_kind",
        ),
        sa.CheckConstraint(
            "suppressed IS NULL OR suppressed IN ('opt_out', 'active_today', 'quiet', 'fatigue', 'backoff', 'budget', 'no_content', 'no_push', 'holdout')",
            name="ck_nudge_suppressed",
        ),
        sa.ForeignKeyConstraint(
            ["notification_id"], ["notification.id"], ondelete="SET NULL"
        ),
        sa.ForeignKeyConstraint(["owner_id"], ["user.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenant.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("owner_id", "dedupe_key", name="uq_nudge_dedupe"),
    )
    _owned("nudge")
    op.create_index("ix_nudge_notification_id", "nudge", ["notification_id"])
    op.create_index("ix_nudge_owner_day", "nudge", ["owner_id", "day"])

    op.add_column(
        "user_profile",
        sa.Column(
            "push_permission_changed_at", sa.DateTime(timezone=True), nullable=True
        ),
    )
    op.add_column(
        "user_profile",
        sa.Column(
            "nudge_mode", sa.String(length=8), server_default="daily", nullable=False
        ),
    )
    op.add_column(
        "user_profile", sa.Column("nudge_time", sa.String(length=5), nullable=True)
    )
    op.create_check_constraint(
        "ck_user_profile_nudge_mode",
        "user_profile",
        "nudge_mode IN ('daily', 'weekly', 'off')",
    )
    op.drop_constraint("ck_usage_event_kind", "usage_event", type_="check")
    op.create_check_constraint("ck_usage_event_kind", "usage_event", NEW_KINDS)
    op.drop_constraint("ck_usage_event_detail", "usage_event", type_="check")
    op.create_check_constraint("ck_usage_event_detail", "usage_event", NEW_DETAIL)


def downgrade() -> None:
    # push_open does not fit the old vocabulary: those rows go with it.
    op.execute("DELETE FROM usage_event WHERE kind = 'push_open'")
    op.drop_constraint("ck_usage_event_detail", "usage_event", type_="check")
    op.create_check_constraint("ck_usage_event_detail", "usage_event", OLD_DETAIL)
    op.drop_constraint("ck_usage_event_kind", "usage_event", type_="check")
    op.create_check_constraint("ck_usage_event_kind", "usage_event", OLD_KINDS)
    op.drop_constraint("ck_user_profile_nudge_mode", "user_profile", type_="check")
    op.drop_column("user_profile", "nudge_time")
    op.drop_column("user_profile", "nudge_mode")
    op.drop_column("user_profile", "push_permission_changed_at")
    op.drop_table("nudge")
    op.drop_table("retention_profile")
