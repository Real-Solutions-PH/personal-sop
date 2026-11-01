"""Fern feedback and shared rules.

``fern_feedback``: one signal about one Fern reply (a thumb, or a
correction, frustration or undo read from what the person did next). Owned,
tenant-isolated and synced like every user row.

``fern_rule`` / ``fern_rule_vote``: behaviour rules learned for every Fern
from many people's feedback. App-wide by design (like ``weather_cache``):
no owner, no tenant, and no personal data — the text passed a
de-identification check before it was written (``companion.feedback``),
and a vote keeps only a keyed hash of who, to count distinct people.

Revision ID: da6a0c041e3e
Revises: c5e1d0a7b391
Create Date: 2026-11-01
"""

import sqlalchemy as sa
from alembic import op
from pgvector.sqlalchemy import Vector

revision = "da6a0c041e3e"
down_revision = "c5e1d0a7b391"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "fern_rule",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("text", sa.String(length=300), nullable=False),
        sa.Column("text_hash", sa.String(length=64), nullable=False),
        sa.Column(
            "status", sa.String(length=10), nullable=False, server_default="proposed"
        ),
        sa.Column("evidence", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("users", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("embedding", Vector(1024), nullable=True),
        sa.Column("embed_model", sa.String(length=120), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column("decided_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "status IN ('proposed', 'approved', 'rejected')", name="ck_fern_rule_status"
        ),
        sa.CheckConstraint("evidence >= 0 AND users >= 0", name="ck_fern_rule_counts"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("text_hash", name="uq_fern_rule_text"),
    )
    op.create_table(
        "fern_rule_vote",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("rule_id", sa.Uuid(), nullable=False),
        sa.Column("voter", sa.String(length=64), nullable=False),
        sa.Column("count", sa.Integer(), nullable=False, server_default="1"),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.ForeignKeyConstraint(["rule_id"], ["fern_rule.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("rule_id", "voter", name="uq_fern_rule_vote"),
    )
    op.create_index(op.f("ix_fern_rule_vote_rule_id"), "fern_rule_vote", ["rule_id"])
    op.create_table(
        "fern_feedback",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("owner_id", sa.Uuid(), nullable=False),
        sa.Column("tenant_id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("version", sa.BigInteger(), server_default="0", nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("message_id", sa.Uuid(), nullable=False),
        sa.Column("kind", sa.String(length=12), nullable=False),
        sa.Column("rating", sa.String(length=4), nullable=False),
        sa.Column("reason", sa.String(length=10), nullable=True),
        sa.Column("note", sa.String(length=280), nullable=True),
        sa.Column("said", sa.String(length=500), nullable=True),
        sa.Column("digested", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.CheckConstraint(
            "kind IN ('thumb', 'correction', 'frustration', 'undo')",
            name="ck_fern_feedback_kind",
        ),
        sa.CheckConstraint("rating IN ('up', 'down')", name="ck_fern_feedback_rating"),
        sa.CheckConstraint(
            "reason IS NULL OR reason IN "
            "('wrong', 'too_long', 'missed', 'slow', 'other')",
            name="ck_fern_feedback_reason",
        ),
        sa.ForeignKeyConstraint(
            ["message_id"], ["companion_message.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(["owner_id"], ["user.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenant.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "owner_id", "message_id", "kind", name="uq_fern_feedback_kind"
        ),
    )
    for cols in (
        ["deleted_at"],
        ["message_id"],
        ["owner_id"],
        ["tenant_id"],
        ["version"],
    ):
        op.create_index(op.f(f"ix_fern_feedback_{cols[0]}"), "fern_feedback", cols)
    op.create_index(
        "ix_fern_feedback_owner_version", "fern_feedback", ["owner_id", "version"]
    )
    op.execute(
        "CREATE TRIGGER fern_feedback_sync_version BEFORE INSERT OR UPDATE"
        " ON fern_feedback FOR EACH ROW EXECUTE FUNCTION set_sync_version()"
    )
    op.execute("ALTER TABLE fern_feedback ENABLE ROW LEVEL SECURITY")
    op.execute(
        """
        CREATE POLICY fern_feedback_tenant_isolation ON fern_feedback
            USING (tenant_id = app_tenant_id())
            WITH CHECK (tenant_id = app_tenant_id())
        """
    )


def downgrade() -> None:
    op.drop_table("fern_feedback")
    op.drop_table("fern_rule_vote")
    op.drop_table("fern_rule")
