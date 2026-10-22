"""memory layer

Revision ID: c3f81e2a9d57
Revises: a65a6331fd8c
Create Date: 2026-10-22 14:00:00.000000

"""

import sqlalchemy as sa
from alembic import op
from pgvector.sqlalchemy import Vector
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = "c3f81e2a9d57"
down_revision = "a65a6331fd8c"
branch_labels = None
depends_on = None

KINDS = (
    "response_style",
    "preference",
    "profile",
    "fact",
    "goal",
    "relationship",
    "health",
    "routine",
    "event",
)
OLD_PURPOSES = ("chat", "capture", "vision", "transcription", "advisor")


def _in(col: str, values: tuple[str, ...]) -> str:
    return f"{col} IN (" + ", ".join(f"'{v}'" for v in values) + ")"


def upgrade():
    # Fern's memories become a recall layer: kind, tags, importance, an
    # always-on flag, where each came from, a hash for exact repeats, an
    # embedding for meaning (pgvector), and a supersede chain for updates.
    op.execute("CREATE EXTENSION IF NOT EXISTS vector")
    op.add_column(
        "memory",
        sa.Column("kind", sa.String(16), nullable=False, server_default="fact"),
    )
    op.add_column(
        "memory",
        sa.Column(
            "tags",
            postgresql.JSONB(),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
    )
    op.add_column(
        "memory",
        sa.Column("importance", sa.SmallInteger(), nullable=False, server_default="3"),
    )
    op.add_column(
        "memory",
        sa.Column(
            "always_on", sa.Boolean(), nullable=False, server_default=sa.false()
        ),
    )
    op.add_column(
        "memory",
        sa.Column("source", sa.String(10), nullable=False, server_default="said"),
    )
    op.add_column("memory", sa.Column("text_hash", sa.String(64)))
    op.add_column("memory", sa.Column("embedding", Vector(1024)))
    op.add_column("memory", sa.Column("embed_model", sa.String(120)))
    op.add_column("memory", sa.Column("last_used_at", sa.DateTime(timezone=True)))
    op.add_column(
        "memory",
        sa.Column("use_count", sa.Integer(), nullable=False, server_default="0"),
    )
    op.add_column(
        "memory",
        sa.Column(
            "superseded_by",
            sa.Uuid(),
            sa.ForeignKey("memory.id", ondelete="SET NULL"),
        ),
    )
    op.create_check_constraint("ck_memory_kind", "memory", _in("kind", KINDS))
    op.create_check_constraint(
        "ck_memory_source", "memory", _in("source", ("said", "inferred", "app"))
    )
    op.create_check_constraint(
        "ck_memory_importance", "memory", "importance BETWEEN 1 AND 5"
    )
    op.create_index("ix_memory_text_hash", "memory", ["text_hash"])
    op.create_index(
        "ix_memory_embedding_hnsw",
        "memory",
        ["embedding"],
        postgresql_using="hnsw",
        postgresql_ops={"embedding": "vector_cosine_ops"},
    )
    op.create_index(
        "ix_memory_text_fts",
        "memory",
        [sa.text("to_tsvector('simple', text)")],
        postgresql_using="gin",
    )
    # The conversation older than each turn's window, kept as a summary.
    op.add_column("companion", sa.Column("summary", sa.String(2000)))
    op.add_column(
        "companion", sa.Column("summary_through", sa.DateTime(timezone=True))
    )
    # Embeddings are a model purpose of their own (metered and assignable).
    for table, name in (
        ("ai_model_assignment", "ck_ai_assignment_purpose"),
        ("ai_usage", "ck_ai_usage_purpose"),
    ):
        op.drop_constraint(name, table, type_="check")
        op.create_check_constraint(
            name, table, _in("purpose", (*OLD_PURPOSES, "embedding"))
        )


def downgrade():
    op.drop_column("companion", "summary_through")
    op.drop_column("companion", "summary")
    for table, name in (
        ("ai_model_assignment", "ck_ai_assignment_purpose"),
        ("ai_usage", "ck_ai_usage_purpose"),
    ):
        op.execute(f"DELETE FROM {table} WHERE purpose = 'embedding'")
        op.drop_constraint(name, table, type_="check")
        op.create_check_constraint(name, table, _in("purpose", OLD_PURPOSES))
    op.drop_index("ix_memory_text_fts", table_name="memory")
    op.drop_index("ix_memory_embedding_hnsw", table_name="memory")
    op.drop_index("ix_memory_text_hash", table_name="memory")
    op.drop_constraint("ck_memory_importance", "memory", type_="check")
    op.drop_constraint("ck_memory_source", "memory", type_="check")
    op.drop_constraint("ck_memory_kind", "memory", type_="check")
    # A superseded memory was history only; it goes with the chain.
    op.execute("DELETE FROM memory WHERE superseded_by IS NOT NULL")
    for c in (
        "superseded_by",
        "use_count",
        "last_used_at",
        "embed_model",
        "embedding",
        "text_hash",
        "source",
        "always_on",
        "importance",
        "tags",
        "kind",
    ):
        op.drop_column("memory", c)
    # The extension stays: dropping it would fail if anything else used it.
