"""shared finance: shared savings goals and shared budgets

Revision ID: a3c5e7f9b1d2
Revises: fdde1d333830
Create Date: 2026-11-15 14:00:00.000000

Five tables, each with the sync-version trigger and the tenant row-level
security policy every owned table has:

- ``shared_goal`` / ``shared_budget``: the shared object, owned by its maker;
- ``shared_membership``: one row per person per goal or budget (role, invite
  status, and for a budget the member's own categories that count);
- ``goal_entry``: a deposit (final when made) or a withdrawal another member
  answers; a trigger keeps a decided entry's amount, date, kind and decision;
- ``shared_event``: the append-only audit trail (UPDATE refused).

``shared_member`` (each member's synced view) admits the kinds ``goal`` and
``budget`` and the roles ``owner`` and ``member``. The way down deletes those
views, puts the two CHECKs back and drops the tables.
"""

import sqlalchemy as sa
import sqlmodel.sql.sqltypes
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "a3c5e7f9b1d2"
down_revision = "fdde1d333830"
branch_labels = None
depends_on = None

TABLES = (
    "shared_goal",
    "shared_budget",
    "shared_membership",
    "goal_entry",
    "shared_event",
)


def _owned_columns() -> list[sa.Column]:  # type: ignore[type-arg]
    return [
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("owner_id", sa.Uuid(), nullable=False),
        sa.Column("tenant_id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("version", sa.BigInteger(), server_default="0", nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
    ]


def _owned_fks() -> list[sa.ForeignKeyConstraint]:
    return [
        sa.ForeignKeyConstraint(["owner_id"], ["user.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenant.id"], ondelete="CASCADE"),
    ]


def _owned_indexes(table: str) -> None:
    for col in ("deleted_at", "owner_id", "tenant_id", "version"):
        op.create_index(op.f(f"ix_{table}_{col}"), table, [col], unique=False)
    op.create_index(
        f"ix_{table}_owner_version", table, ["owner_id", "version"], unique=False
    )


def _status(table: str) -> sa.CheckConstraint:
    return sa.CheckConstraint(
        "status IN ('active', 'closed')", name=f"ck_{table}_status"
    )


def upgrade() -> None:
    op.create_table(
        "shared_goal",
        *_owned_columns(),
        sa.Column("name", sqlmodel.sql.sqltypes.AutoString(length=80), nullable=False),
        sa.Column("target_minor", sa.BigInteger(), nullable=True),
        sa.Column("deadline", sa.Date(), nullable=True),
        sa.Column("currency", sa.String(length=3), nullable=False),
        sa.Column("status", sa.String(length=8), nullable=False),
        _status("shared_goal"),
        sa.CheckConstraint(
            "target_minor IS NULL OR "
            "(target_minor > 0 AND target_minor <= 100000000000000)",
            name="ck_shared_goal_target",
        ),
        *_owned_fks(),
        sa.PrimaryKeyConstraint("id"),
    )
    _owned_indexes("shared_goal")

    op.create_table(
        "shared_budget",
        *_owned_columns(),
        sa.Column("name", sqlmodel.sql.sqltypes.AutoString(length=80), nullable=False),
        sa.Column("limit_minor", sa.BigInteger(), nullable=False),
        sa.Column("currency", sa.String(length=3), nullable=False),
        sa.Column("status", sa.String(length=8), nullable=False),
        _status("shared_budget"),
        sa.CheckConstraint(
            "limit_minor > 0 AND limit_minor <= 100000000000000",
            name="ck_shared_budget_limit",
        ),
        *_owned_fks(),
        sa.PrimaryKeyConstraint("id"),
    )
    _owned_indexes("shared_budget")

    op.create_table(
        "shared_membership",
        *_owned_columns(),
        sa.Column("kind", sa.String(length=8), nullable=False),
        sa.Column("object_id", sa.Uuid(), nullable=False),
        sa.Column("role", sa.String(length=8), nullable=False),
        sa.Column("status", sa.String(length=8), nullable=False),
        sa.Column(
            "category_ids", postgresql.JSONB(astext_type=sa.Text()), nullable=False
        ),
        sa.Column("joined_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "kind IN ('goal', 'budget')", name="ck_shared_membership_kind"
        ),
        sa.CheckConstraint(
            "role IN ('owner', 'member')", name="ck_shared_membership_role"
        ),
        sa.CheckConstraint(
            "status IN ('invited', 'active', 'declined', 'left')",
            name="ck_shared_membership_status",
        ),
        *_owned_fks(),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "owner_id", "kind", "object_id", name="uq_shared_membership"
        ),
    )
    _owned_indexes("shared_membership")
    op.create_index(
        "ix_shared_membership_object",
        "shared_membership",
        ["kind", "object_id"],
        unique=False,
    )

    op.create_table(
        "goal_entry",
        *_owned_columns(),
        sa.Column("goal_id", sa.Uuid(), nullable=False),
        sa.Column("kind", sa.String(length=10), nullable=False),
        sa.Column("status", sa.String(length=10), nullable=False),
        sa.Column("amount_minor", sa.BigInteger(), nullable=False),
        sa.Column("on_date", sa.Date(), nullable=False),
        sa.Column("note", sqlmodel.sql.sqltypes.AutoString(length=280), nullable=True),
        sa.Column("account_id", sa.Uuid(), nullable=True),
        sa.Column("record_id", sa.Uuid(), nullable=True),
        sa.Column("decided_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("decided_by", sa.Uuid(), nullable=True),
        sa.Column(
            "reason", sqlmodel.sql.sqltypes.AutoString(length=280), nullable=True
        ),
        sa.CheckConstraint(
            "kind IN ('deposit', 'withdrawal')", name="ck_goal_entry_kind"
        ),
        sa.CheckConstraint(
            "status IN ('sent', 'accepted', 'rejected', 'withdrawn')",
            name="ck_goal_entry_status",
        ),
        sa.CheckConstraint(
            "amount_minor > 0 AND amount_minor <= 100000000000000",
            name="ck_goal_entry_amount",
        ),
        sa.CheckConstraint(
            "(status = 'sent') = (decided_at IS NULL)", name="ck_goal_entry_decided"
        ),
        sa.CheckConstraint(
            "status <> 'rejected' OR reason IS NOT NULL", name="ck_goal_entry_reason"
        ),
        sa.ForeignKeyConstraint(["goal_id"], ["shared_goal.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["account_id"], ["account.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["record_id"], ["fin_record.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["decided_by"], ["user.id"], ondelete="SET NULL"),
        *_owned_fks(),
        sa.PrimaryKeyConstraint("id"),
    )
    _owned_indexes("goal_entry")
    op.create_index(
        op.f("ix_goal_entry_goal_id"), "goal_entry", ["goal_id"], unique=False
    )

    op.create_table(
        "shared_event",
        *_owned_columns(),
        sa.Column("object_kind", sa.String(length=8), nullable=False),
        sa.Column("object_id", sa.Uuid(), nullable=False),
        sa.Column("entry_id", sa.Uuid(), nullable=True),
        sa.Column("kind", sa.String(length=20), nullable=False),
        sa.Column("at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("amount_minor", sa.BigInteger(), nullable=True),
        sa.Column("text", sqlmodel.sql.sqltypes.AutoString(length=280), nullable=True),
        sa.CheckConstraint(
            "kind IN ('created', 'joined', 'declined', 'deposited', "
            "'withdrawal_sent', 'withdrawal_accepted', 'withdrawal_rejected', "
            "'withdrawal_withdrawn', 'categories_set', 'threshold')",
            name="ck_shared_event_kind",
        ),
        sa.CheckConstraint(
            "object_kind IN ('goal', 'budget')", name="ck_shared_event_object_kind"
        ),
        sa.ForeignKeyConstraint(["entry_id"], ["goal_entry.id"], ondelete="CASCADE"),
        *_owned_fks(),
        sa.PrimaryKeyConstraint("id"),
    )
    _owned_indexes("shared_event")
    op.create_index(
        "ix_shared_event_object",
        "shared_event",
        ["object_kind", "object_id"],
        unique=False,
    )

    for table in TABLES:
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

    # The loan's append-only guard serves the shared trail too.
    op.execute(
        "CREATE TRIGGER shared_event_no_update BEFORE UPDATE ON shared_event"
        " FOR EACH ROW EXECUTE FUNCTION loan_event_append_only()"
    )
    op.execute(
        """
        CREATE FUNCTION goal_entry_decided_is_final() RETURNS trigger AS $$
        BEGIN
            IF OLD.status <> 'sent' AND (
                NEW.status IS DISTINCT FROM OLD.status
                OR NEW.amount_minor IS DISTINCT FROM OLD.amount_minor
                OR NEW.on_date IS DISTINCT FROM OLD.on_date
                OR NEW.kind IS DISTINCT FROM OLD.kind
                OR NEW.decided_at IS DISTINCT FROM OLD.decided_at
                OR NEW.decided_by IS DISTINCT FROM OLD.decided_by
                    AND NEW.decided_by IS NOT NULL
            ) THEN
                RAISE EXCEPTION 'a decided goal entry is final';
            END IF;
            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql
        """
    )
    op.execute(
        "CREATE TRIGGER goal_entry_final BEFORE UPDATE ON goal_entry"
        " FOR EACH ROW EXECUTE FUNCTION goal_entry_decided_is_final()"
    )

    op.drop_constraint("ck_shared_member_kind", "shared_member", type_="check")
    op.create_check_constraint(
        "ck_shared_member_kind", "shared_member", "kind IN ('loan', 'goal', 'budget')"
    )
    op.drop_constraint("ck_shared_member_role", "shared_member", type_="check")
    op.create_check_constraint(
        "ck_shared_member_role",
        "shared_member",
        "role IN ('lender', 'borrower', 'owner', 'member')",
    )


def downgrade() -> None:
    op.execute("DELETE FROM shared_member WHERE kind IN ('goal', 'budget')")
    op.drop_constraint("ck_shared_member_role", "shared_member", type_="check")
    op.create_check_constraint(
        "ck_shared_member_role", "shared_member", "role IN ('lender', 'borrower')"
    )
    op.drop_constraint("ck_shared_member_kind", "shared_member", type_="check")
    op.create_check_constraint(
        "ck_shared_member_kind", "shared_member", "kind IN ('loan')"
    )
    op.drop_table("shared_event")
    op.drop_table("goal_entry")
    op.drop_table("shared_membership")
    op.drop_table("shared_budget")
    op.drop_table("shared_goal")
    op.execute("DROP FUNCTION IF EXISTS goal_entry_decided_is_final()")
