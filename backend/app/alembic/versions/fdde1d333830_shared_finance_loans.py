"""shared finance: loans between two people

Revision ID: fdde1d333830
Revises: ec27c6bfa274
Create Date: 2026-11-15 12:00:00.000000

Four tables, each with the sync-version trigger and the tenant row-level
security policy every owned table has:

- ``loan``: owned by the lender, naming the borrower; the schedule and its
  installments are fixed when the loan is made.
- ``loan_payment``: one repayment, sent by the borrower or recorded as cash
  by the lender. A trigger keeps a decided payment's amount, date, kind and
  decision as they were: once out of ``sent`` it is never rewritten.
- ``loan_event``: the append-only audit trail (a trigger refuses UPDATE;
  rows go only with their loan or their user).
- ``shared_member``: each member's synced, server-written view of a loan.

New tables only, no data to move; the way down drops them.
"""

import sqlalchemy as sa
import sqlmodel.sql.sqltypes
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "fdde1d333830"
down_revision = "ec27c6bfa274"
branch_labels = None
depends_on = None

TABLES = ("loan", "loan_payment", "loan_event", "shared_member")


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


def _owned_indexes(table: str) -> None:
    for col in ("deleted_at", "owner_id", "tenant_id", "version"):
        op.create_index(op.f(f"ix_{table}_{col}"), table, [col], unique=False)
    op.create_index(
        f"ix_{table}_owner_version", table, ["owner_id", "version"], unique=False
    )


def _owned_fks() -> list[sa.ForeignKeyConstraint]:
    return [
        sa.ForeignKeyConstraint(["owner_id"], ["user.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenant.id"], ondelete="CASCADE"),
    ]


def upgrade() -> None:
    op.create_table(
        "loan",
        *_owned_columns(),
        sa.Column("borrower_id", sa.Uuid(), nullable=False),
        sa.Column("status", sa.String(length=10), nullable=False),
        sa.Column("principal_minor", sa.BigInteger(), nullable=False),
        sa.Column("interest_minor", sa.BigInteger(), nullable=False),
        sa.Column("currency", sa.String(length=3), nullable=False),
        sa.Column(
            "purpose", sqlmodel.sql.sqltypes.AutoString(length=120), nullable=True
        ),
        sa.Column("lender_account_id", sa.Uuid(), nullable=True),
        sa.Column("outlay_record_id", sa.Uuid(), nullable=True),
        sa.Column("schedule", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column(
            "installments", postgresql.JSONB(astext_type=sa.Text()), nullable=False
        ),
        sa.Column("responded_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("closed_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "status IN ('invited', 'active', 'declined', 'cancelled', 'paid')",
            name="ck_loan_status",
        ),
        sa.CheckConstraint(
            "interest_minor BETWEEN 0 AND 100000000000000", name="ck_loan_interest"
        ),
        sa.CheckConstraint("owner_id <> borrower_id", name="ck_loan_self"),
        sa.CheckConstraint(
            "principal_minor > 0 AND principal_minor <= 100000000000000",
            name="ck_loan_principal",
        ),
        sa.ForeignKeyConstraint(["borrower_id"], ["user.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["lender_account_id"], ["account.id"], ondelete="SET NULL"
        ),
        sa.ForeignKeyConstraint(
            ["outlay_record_id"], ["fin_record.id"], ondelete="SET NULL"
        ),
        *_owned_fks(),
        sa.PrimaryKeyConstraint("id"),
    )
    _owned_indexes("loan")
    op.create_index(op.f("ix_loan_borrower_id"), "loan", ["borrower_id"], unique=False)

    op.create_table(
        "loan_payment",
        *_owned_columns(),
        sa.Column("loan_id", sa.Uuid(), nullable=False),
        sa.Column("kind", sa.String(length=8), nullable=False),
        sa.Column("status", sa.String(length=10), nullable=False),
        sa.Column("amount_minor", sa.BigInteger(), nullable=False),
        sa.Column("paid_on", sa.Date(), nullable=False),
        sa.Column("note", sqlmodel.sql.sqltypes.AutoString(length=280), nullable=True),
        sa.Column("proof_media_id", sa.Uuid(), nullable=True),
        sa.Column("borrower_account_id", sa.Uuid(), nullable=True),
        sa.Column("lender_account_id", sa.Uuid(), nullable=True),
        sa.Column("decided_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("decided_by", sa.Uuid(), nullable=True),
        sa.Column(
            "reason", sqlmodel.sql.sqltypes.AutoString(length=280), nullable=True
        ),
        sa.Column("lender_record_id", sa.Uuid(), nullable=True),
        sa.Column("borrower_record_id", sa.Uuid(), nullable=True),
        sa.CheckConstraint(
            "(status = 'sent') = (decided_at IS NULL)", name="ck_loan_payment_decided"
        ),
        sa.CheckConstraint("kind IN ('transfer', 'cash')", name="ck_loan_payment_kind"),
        sa.CheckConstraint(
            "status <> 'rejected' OR reason IS NOT NULL", name="ck_loan_payment_reason"
        ),
        sa.CheckConstraint(
            "status IN ('sent', 'accepted', 'rejected', 'withdrawn')",
            name="ck_loan_payment_status",
        ),
        sa.CheckConstraint(
            "amount_minor > 0 AND amount_minor <= 100000000000000",
            name="ck_loan_payment_amount",
        ),
        sa.ForeignKeyConstraint(
            ["borrower_account_id"], ["account.id"], ondelete="SET NULL"
        ),
        sa.ForeignKeyConstraint(
            ["borrower_record_id"], ["fin_record.id"], ondelete="SET NULL"
        ),
        sa.ForeignKeyConstraint(["decided_by"], ["user.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(
            ["lender_account_id"], ["account.id"], ondelete="SET NULL"
        ),
        sa.ForeignKeyConstraint(
            ["lender_record_id"], ["fin_record.id"], ondelete="SET NULL"
        ),
        sa.ForeignKeyConstraint(["loan_id"], ["loan.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["proof_media_id"], ["media_object.id"], ondelete="SET NULL"
        ),
        *_owned_fks(),
        sa.PrimaryKeyConstraint("id"),
    )
    _owned_indexes("loan_payment")
    op.create_index(
        op.f("ix_loan_payment_loan_id"), "loan_payment", ["loan_id"], unique=False
    )
    op.create_index(
        "ix_loan_payment_loan_status",
        "loan_payment",
        ["loan_id", "status"],
        unique=False,
    )

    op.create_table(
        "loan_event",
        *_owned_columns(),
        sa.Column("loan_id", sa.Uuid(), nullable=False),
        sa.Column("payment_id", sa.Uuid(), nullable=True),
        sa.Column("kind", sa.String(length=20), nullable=False),
        sa.Column("at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("amount_minor", sa.BigInteger(), nullable=True),
        sa.Column("text", sqlmodel.sql.sqltypes.AutoString(length=280), nullable=True),
        sa.CheckConstraint(
            "kind IN ('created', 'accepted', 'declined', 'cancelled', "
            "'payment_sent', 'payment_accepted', 'payment_rejected', "
            "'payment_withdrawn', 'cash_recorded', 'paid_off')",
            name="ck_loan_event_kind",
        ),
        sa.ForeignKeyConstraint(["loan_id"], ["loan.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["payment_id"], ["loan_payment.id"], ondelete="CASCADE"
        ),
        *_owned_fks(),
        sa.PrimaryKeyConstraint("id"),
    )
    _owned_indexes("loan_event")
    op.create_index(
        op.f("ix_loan_event_loan_id"), "loan_event", ["loan_id"], unique=False
    )

    op.create_table(
        "shared_member",
        *_owned_columns(),
        sa.Column("kind", sa.String(length=8), nullable=False),
        sa.Column("object_id", sa.Uuid(), nullable=False),
        sa.Column("role", sa.String(length=10), nullable=False),
        sa.Column("status", sa.String(length=10), nullable=False),
        sa.Column("data", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.CheckConstraint("kind IN ('loan')", name="ck_shared_member_kind"),
        sa.CheckConstraint(
            "role IN ('lender', 'borrower')", name="ck_shared_member_role"
        ),
        *_owned_fks(),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("owner_id", "kind", "object_id", name="uq_shared_member"),
    )
    _owned_indexes("shared_member")
    op.create_index(
        op.f("ix_shared_member_object_id"),
        "shared_member",
        ["object_id"],
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

    op.execute(
        """
        CREATE FUNCTION loan_event_append_only() RETURNS trigger AS $$
        BEGIN
            RAISE EXCEPTION 'loan_event is append-only';
        END;
        $$ LANGUAGE plpgsql
        """
    )
    op.execute(
        "CREATE TRIGGER loan_event_no_update BEFORE UPDATE ON loan_event"
        " FOR EACH ROW EXECUTE FUNCTION loan_event_append_only()"
    )
    op.execute(
        """
        CREATE FUNCTION loan_payment_decided_is_final() RETURNS trigger AS $$
        BEGIN
            IF OLD.status <> 'sent' AND (
                NEW.status IS DISTINCT FROM OLD.status
                OR NEW.amount_minor IS DISTINCT FROM OLD.amount_minor
                OR NEW.paid_on IS DISTINCT FROM OLD.paid_on
                OR NEW.kind IS DISTINCT FROM OLD.kind
                OR NEW.decided_at IS DISTINCT FROM OLD.decided_at
                OR NEW.decided_by IS DISTINCT FROM OLD.decided_by
                    AND NEW.decided_by IS NOT NULL
            ) THEN
                RAISE EXCEPTION 'a decided loan payment is final';
            END IF;
            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql
        """
    )
    op.execute(
        "CREATE TRIGGER loan_payment_final BEFORE UPDATE ON loan_payment"
        " FOR EACH ROW EXECUTE FUNCTION loan_payment_decided_is_final()"
    )


def downgrade() -> None:
    op.drop_table("shared_member")
    op.drop_table("loan_event")
    op.drop_table("loan_payment")
    op.drop_table("loan")
    op.execute("DROP FUNCTION IF EXISTS loan_event_append_only()")
    op.execute("DROP FUNCTION IF EXISTS loan_payment_decided_is_final()")
