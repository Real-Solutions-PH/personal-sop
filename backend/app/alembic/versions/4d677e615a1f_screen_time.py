"""Screen time (spec 2026-10-29-screen-time-design).

Two tables: ``screen_group`` (a named set of apps picked on the phone and its
daily budget; one live ``all`` group per person) and ``screen_day`` (one
group's lower bound of minutes used on one app day), each with the
sync-version trigger and the tenant row-level security policy every owned
table has. ``habit`` gains a screen-time rule (``rule_kind``,
``rule_group_id``, ``rule_max_min``: all set or none), ``habit_log.source``
admits ``screen`` and the three module-key checks admit ``screen``.

Revision ID: 4d677e615a1f
Revises: ed6795f25585
Create Date: 2026-10-29

"""

from typing import Any

import sqlalchemy as sa
import sqlmodel.sql.sqltypes
from alembic import op

revision = "4d677e615a1f"
down_revision = "ed6795f25585"
branch_labels = None
depends_on = None

OLD_KEYS = ("habits", "tasks", "fitness", "nutrition", "focus", "finance")
NEW_KEYS = ("habits", "tasks", "fitness", "nutrition", "focus", "finance", "screen")
CHECKS = (
    ("module_pref", "ck_module_pref_module"),
    ("setup_skip", "ck_setup_skip_module"),
    ("daily_module_stat", "ck_daily_module_stat_module"),
)
OLD_SOURCES = ("tap", "timer", "routine", "capture", "workout")
NEW_SOURCES = ("tap", "timer", "routine", "capture", "workout", "screen")
TABLES = ("screen_group", "screen_day")


def _in(column: str, values: tuple[str, ...]) -> str:
    return f"{column} IN (" + ", ".join(f"'{v}'" for v in values) + ")"


def _checks(keys: tuple[str, ...], sources: tuple[str, ...]) -> None:
    for table, name in CHECKS:
        op.drop_constraint(name, table, type_="check")
        op.create_check_constraint(name, table, _in("module", keys))
    op.drop_constraint("ck_habit_log_source", "habit_log", type_="check")
    op.create_check_constraint(
        "ck_habit_log_source", "habit_log", _in("source", sources)
    )


def _owned(table: str) -> None:
    """The indexes, sync-version trigger and RLS policy of an owned table."""
    for column in ("deleted_at", "owner_id", "tenant_id", "version"):
        op.create_index(f"ix_{table}_{column}", table, [column], unique=False)
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


def _owned_columns() -> list[Any]:
    return [
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("owner_id", sa.Uuid(), nullable=False),
        sa.Column("tenant_id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("version", sa.BigInteger(), server_default="0", nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
    ]


def _owned_keys() -> list[Any]:
    return [
        sa.ForeignKeyConstraint(["owner_id"], ["user.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenant.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    ]


def upgrade() -> None:
    op.create_table(
        "screen_group",
        *_owned_columns(),
        sa.Column("name", sqlmodel.sql.sqltypes.AutoString(length=40), nullable=False),
        sa.Column("kind", sa.String(length=8), nullable=False),
        sa.Column("budget_min", sa.Integer(), nullable=False),
        sa.Column("sort_order", sa.Integer(), nullable=False),
        sa.Column("archived_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint("kind IN ('all', 'custom')", name="ck_screen_group_kind"),
        sa.CheckConstraint("budget_min >= 0", name="ck_screen_group_budget"),
        *_owned_keys(),
    )
    op.create_index(
        "uq_screen_group_one_all",
        "screen_group",
        ["owner_id"],
        unique=True,
        postgresql_where=sa.text("kind = 'all' AND deleted_at IS NULL"),
    )
    op.create_table(
        "screen_day",
        *_owned_columns(),
        sa.Column("group_id", sa.Uuid(), nullable=False),
        sa.Column("day", sa.Date(), nullable=False),
        sa.Column("used_min", sa.Integer(), nullable=False),
        sa.Column("closed", sa.Boolean(), nullable=False),
        sa.CheckConstraint("used_min >= 0", name="ck_screen_day_used"),
        sa.ForeignKeyConstraint(["group_id"], ["screen_group.id"], ondelete="CASCADE"),
        *_owned_keys(),
        sa.UniqueConstraint("owner_id", "group_id", "day", name="uq_screen_day"),
    )
    op.create_index("ix_screen_day_day", "screen_day", ["day"], unique=False)
    op.create_index("ix_screen_day_group_id", "screen_day", ["group_id"], unique=False)
    for table in TABLES:
        _owned(table)

    op.add_column("habit", sa.Column("rule_kind", sa.String(length=16), nullable=True))
    op.add_column("habit", sa.Column("rule_group_id", sa.Uuid(), nullable=True))
    op.add_column("habit", sa.Column("rule_max_min", sa.Integer(), nullable=True))
    op.create_index("ix_habit_rule_group_id", "habit", ["rule_group_id"], unique=False)
    op.create_foreign_key(
        "habit_rule_group_id_fkey",
        "habit",
        "screen_group",
        ["rule_group_id"],
        ["id"],
        ondelete="RESTRICT",
    )
    op.create_check_constraint(
        "ck_habit_rule_kind",
        "habit",
        "rule_kind IS NULL OR rule_kind IN ('screen_limit')",
    )
    op.create_check_constraint(
        "ck_habit_rule",
        "habit",
        "(rule_kind IS NULL) = (rule_group_id IS NULL)"
        " AND (rule_kind IS NULL) = (rule_max_min IS NULL)",
    )
    op.create_check_constraint(
        "ck_habit_rule_max",
        "habit",
        "rule_max_min IS NULL OR rule_max_min BETWEEN 0 AND 1440",
    )
    _checks(NEW_KEYS, NEW_SOURCES)


def downgrade() -> None:
    bind = op.get_bind()
    for table, _ in CHECKS:
        bind.execute(sa.text(f"DELETE FROM {table} WHERE module = 'screen'"))
    # The narrower source check cannot hold a screen log.
    bind.execute(sa.text("DELETE FROM habit_log WHERE source = 'screen'"))
    _checks(OLD_KEYS, OLD_SOURCES)
    op.drop_constraint("ck_habit_rule_max", "habit", type_="check")
    op.drop_constraint("ck_habit_rule", "habit", type_="check")
    op.drop_constraint("ck_habit_rule_kind", "habit", type_="check")
    op.drop_constraint("habit_rule_group_id_fkey", "habit", type_="foreignkey")
    op.drop_index("ix_habit_rule_group_id", table_name="habit")
    op.drop_column("habit", "rule_max_min")
    op.drop_column("habit", "rule_group_id")
    op.drop_column("habit", "rule_kind")
    op.drop_table("screen_day")
    op.drop_table("screen_group")
