"""Focus module (ADR-0025).

Three tables: ``focus_session`` (one sitting at the timer, its mode and
lengths), ``focus_segment`` (each span of focus, break or pause, with the
item worked on) and ``focus_settings`` (the daily goal and the timer's
defaults), each with the sync-version trigger and the tenant row-level
security policy every owned table has. ``task.estimate_min`` holds how long
a task is expected to take, so time spent can be shown against it. The three
module-key checks admit ``focus``.

Revision ID: 18269ea0c979
Revises: e7b3d9a1c5f2
Create Date: 2026-10-24

"""

import sqlalchemy as sa
import sqlmodel.sql.sqltypes
from alembic import op

revision = "18269ea0c979"
down_revision = "e7b3d9a1c5f2"
branch_labels = None
depends_on = None

OLD_KEYS = ("habits", "tasks", "fitness", "nutrition", "finance")
NEW_KEYS = ("habits", "tasks", "fitness", "nutrition", "focus", "finance")
CHECKS = (
    ("module_pref", "ck_module_pref_module"),
    ("setup_skip", "ck_setup_skip_module"),
    ("daily_module_stat", "ck_daily_module_stat_module"),
)


def _in(values: tuple[str, ...]) -> str:
    return "module IN (" + ", ".join(f"'{v}'" for v in values) + ")"


def _checks(values: tuple[str, ...]) -> None:
    for table, name in CHECKS:
        op.drop_constraint(name, table, type_="check")
        op.create_check_constraint(name, table, _in(values))


def upgrade() -> None:
    op.create_table(
        "focus_session",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("owner_id", sa.Uuid(), nullable=False),
        sa.Column("tenant_id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("version", sa.BigInteger(), server_default="0", nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("mode", sa.String(length=10), nullable=False),
        sa.Column("preset", sqlmodel.sql.sqltypes.AutoString(length=16), nullable=True),
        sa.Column("focus_min", sa.Integer(), nullable=False),
        sa.Column("short_break_min", sa.Integer(), nullable=False),
        sa.Column("long_break_min", sa.Integer(), nullable=False),
        sa.Column("sets_before_long", sa.Integer(), nullable=False),
        sa.Column("auto_start_breaks", sa.Boolean(), nullable=False),
        sa.Column("auto_start_focus", sa.Boolean(), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("ended_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("end_reason", sa.String(length=10), nullable=True),
        sa.Column("item_kind", sa.String(length=5), nullable=True),
        sa.Column("item_id", sa.Uuid(), nullable=True),
        sa.Column(
            "item_title", sqlmodel.sql.sqltypes.AutoString(length=160), nullable=True
        ),
        sa.Column("day", sa.Date(), nullable=True),
        sa.Column("focus_sec", sa.Integer(), nullable=False),
        sa.Column("sets_completed", sa.Integer(), nullable=False),
        sa.CheckConstraint(
            "end_reason IS NULL OR end_reason IN ('completed', 'abandoned')",
            name="ck_focus_session_end_reason",
        ),
        sa.CheckConstraint(
            "item_kind IS NULL OR item_kind IN ('task', 'habit')",
            name="ck_focus_session_item_kind",
        ),
        sa.CheckConstraint(
            "mode IN ('pomodoro', 'stopwatch')", name="ck_focus_session_mode"
        ),
        sa.CheckConstraint(
            "(item_kind IS NULL) = (item_id IS NULL)", name="ck_focus_session_item"
        ),
        sa.CheckConstraint(
            "ended_at IS NULL OR ended_at >= started_at", name="ck_focus_session_range"
        ),
        sa.CheckConstraint(
            "focus_min BETWEEN 1 AND 240 AND short_break_min BETWEEN 1 AND 60 AND long_break_min BETWEEN 1 AND 120 AND sets_before_long BETWEEN 1 AND 12",
            name="ck_focus_session_lengths",
        ),
        sa.CheckConstraint(
            "focus_sec >= 0 AND sets_completed >= 0", name="ck_focus_session_totals"
        ),
        sa.ForeignKeyConstraint(["owner_id"], ["user.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenant.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_focus_session_deleted_at"),
        "focus_session",
        ["deleted_at"],
        unique=False,
    )
    op.create_index(
        "ix_focus_session_owner_day", "focus_session", ["owner_id", "day"], unique=False
    )
    op.create_index(
        op.f("ix_focus_session_owner_id"), "focus_session", ["owner_id"], unique=False
    )
    op.create_index(
        "ix_focus_session_owner_version",
        "focus_session",
        ["owner_id", "version"],
        unique=False,
    )
    op.create_index(
        op.f("ix_focus_session_tenant_id"), "focus_session", ["tenant_id"], unique=False
    )
    op.create_index(
        op.f("ix_focus_session_version"), "focus_session", ["version"], unique=False
    )
    op.create_table(
        "focus_settings",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("owner_id", sa.Uuid(), nullable=False),
        sa.Column("tenant_id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("version", sa.BigInteger(), server_default="0", nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("daily_goal_min", sa.Integer(), nullable=False),
        sa.Column("mode", sa.String(length=10), nullable=False),
        sa.Column("preset", sqlmodel.sql.sqltypes.AutoString(length=16), nullable=True),
        sa.Column("focus_min", sa.Integer(), nullable=False),
        sa.Column("short_break_min", sa.Integer(), nullable=False),
        sa.Column("long_break_min", sa.Integer(), nullable=False),
        sa.Column("sets_before_long", sa.Integer(), nullable=False),
        sa.Column("auto_start_breaks", sa.Boolean(), nullable=False),
        sa.Column("auto_start_focus", sa.Boolean(), nullable=False),
        sa.Column("notify", sa.Boolean(), nullable=False),
        sa.CheckConstraint(
            "mode IN ('pomodoro', 'stopwatch')", name="ck_focus_settings_mode"
        ),
        sa.CheckConstraint(
            "daily_goal_min BETWEEN 0 AND 960", name="ck_focus_settings_goal"
        ),
        sa.CheckConstraint(
            "focus_min BETWEEN 1 AND 240 AND short_break_min BETWEEN 1 AND 60 AND long_break_min BETWEEN 1 AND 120 AND sets_before_long BETWEEN 1 AND 12",
            name="ck_focus_settings_lengths",
        ),
        sa.ForeignKeyConstraint(["owner_id"], ["user.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenant.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("owner_id", name="uq_focus_settings_owner"),
    )
    op.create_index(
        op.f("ix_focus_settings_deleted_at"),
        "focus_settings",
        ["deleted_at"],
        unique=False,
    )
    op.create_index(
        op.f("ix_focus_settings_owner_id"), "focus_settings", ["owner_id"], unique=False
    )
    op.create_index(
        "ix_focus_settings_owner_version",
        "focus_settings",
        ["owner_id", "version"],
        unique=False,
    )
    op.create_index(
        op.f("ix_focus_settings_tenant_id"),
        "focus_settings",
        ["tenant_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_focus_settings_version"), "focus_settings", ["version"], unique=False
    )
    op.create_table(
        "focus_segment",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("owner_id", sa.Uuid(), nullable=False),
        sa.Column("tenant_id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("version", sa.BigInteger(), server_default="0", nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("session_id", sa.Uuid(), nullable=False),
        sa.Column("kind", sa.String(length=5), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("ended_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("set_index", sa.Integer(), nullable=False),
        sa.Column("planned_sec", sa.Integer(), nullable=True),
        sa.Column("item_kind", sa.String(length=5), nullable=True),
        sa.Column("item_id", sa.Uuid(), nullable=True),
        sa.Column(
            "item_title", sqlmodel.sql.sqltypes.AutoString(length=160), nullable=True
        ),
        sa.CheckConstraint(
            "item_kind IS NULL OR item_kind IN ('task', 'habit')",
            name="ck_focus_segment_item_kind",
        ),
        sa.CheckConstraint(
            "kind IN ('focus', 'break', 'pause')", name="ck_focus_segment_kind"
        ),
        sa.CheckConstraint(
            "(item_kind IS NULL) = (item_id IS NULL)", name="ck_focus_segment_item"
        ),
        sa.CheckConstraint(
            "ended_at IS NULL OR ended_at >= started_at", name="ck_focus_segment_range"
        ),
        sa.CheckConstraint(
            "planned_sec IS NULL OR planned_sec BETWEEN 1 AND 86400",
            name="ck_focus_segment_planned",
        ),
        sa.CheckConstraint("set_index BETWEEN 0 AND 999", name="ck_focus_segment_set"),
        sa.ForeignKeyConstraint(["owner_id"], ["user.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["session_id"], ["focus_session.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenant.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_focus_segment_deleted_at"),
        "focus_segment",
        ["deleted_at"],
        unique=False,
    )
    op.create_index(
        op.f("ix_focus_segment_owner_id"), "focus_segment", ["owner_id"], unique=False
    )
    op.create_index(
        "ix_focus_segment_owner_item",
        "focus_segment",
        ["owner_id", "item_id"],
        unique=False,
    )
    op.create_index(
        "ix_focus_segment_owner_started",
        "focus_segment",
        ["owner_id", "started_at"],
        unique=False,
    )
    op.create_index(
        "ix_focus_segment_owner_version",
        "focus_segment",
        ["owner_id", "version"],
        unique=False,
    )
    op.create_index(
        op.f("ix_focus_segment_session_id"),
        "focus_segment",
        ["session_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_focus_segment_tenant_id"), "focus_segment", ["tenant_id"], unique=False
    )
    op.create_index(
        op.f("ix_focus_segment_version"), "focus_segment", ["version"], unique=False
    )
    op.execute(
        "CREATE TRIGGER focus_session_sync_version BEFORE INSERT OR UPDATE"
        " ON focus_session FOR EACH ROW EXECUTE FUNCTION set_sync_version()"
    )
    op.execute("ALTER TABLE focus_session ENABLE ROW LEVEL SECURITY")
    op.execute(
        """
        CREATE POLICY focus_session_tenant_isolation ON focus_session
            USING (tenant_id = app_tenant_id())
            WITH CHECK (tenant_id = app_tenant_id())
        """
    )
    op.execute(
        "CREATE TRIGGER focus_segment_sync_version BEFORE INSERT OR UPDATE"
        " ON focus_segment FOR EACH ROW EXECUTE FUNCTION set_sync_version()"
    )
    op.execute("ALTER TABLE focus_segment ENABLE ROW LEVEL SECURITY")
    op.execute(
        """
        CREATE POLICY focus_segment_tenant_isolation ON focus_segment
            USING (tenant_id = app_tenant_id())
            WITH CHECK (tenant_id = app_tenant_id())
        """
    )
    op.execute(
        "CREATE TRIGGER focus_settings_sync_version BEFORE INSERT OR UPDATE"
        " ON focus_settings FOR EACH ROW EXECUTE FUNCTION set_sync_version()"
    )
    op.execute("ALTER TABLE focus_settings ENABLE ROW LEVEL SECURITY")
    op.execute(
        """
        CREATE POLICY focus_settings_tenant_isolation ON focus_settings
            USING (tenant_id = app_tenant_id())
            WITH CHECK (tenant_id = app_tenant_id())
        """
    )
    op.add_column("task", sa.Column("estimate_min", sa.Integer(), nullable=True))
    op.create_check_constraint(
        "ck_task_estimate",
        "task",
        "estimate_min IS NULL OR estimate_min BETWEEN 1 AND 6000",
    )
    _checks(NEW_KEYS)


def downgrade() -> None:
    bind = op.get_bind()
    for table, _ in CHECKS:
        bind.execute(sa.text(f"DELETE FROM {table} WHERE module = 'focus'"))
    _checks(OLD_KEYS)
    op.drop_constraint("ck_task_estimate", "task", type_="check")
    op.drop_column("task", "estimate_min")
    op.drop_table("focus_segment")
    op.drop_table("focus_settings")
    op.drop_table("focus_session")
