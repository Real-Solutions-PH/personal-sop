"""The companion (Fern by default): its name, the conversation, trackers and
memories."""

import uuid
from datetime import datetime

from pgvector.sqlalchemy import Vector
from sqlalchemy import (
    CheckConstraint,
    Float,
    Index,
    SmallInteger,
    String,
    UniqueConstraint,
)
from sqlalchemy import text as text_sql
from sqlmodel import Field

from app.modules.ai_providers.public import EMBEDDING_DIMENSIONS
from app.modules.companion.defaults import COMPANION_NAME
from app.shared.owned import JSONB, OwnedRow, enum_check, tstz

METRICS = (
    "life",
    "habits",
    "tasks",
    "spend",
    "spendCats",
    "netWorth",
    "workouts",
    "weight",
    "nutrition",
)


class Companion(OwnedRow, table=True):
    __tablename__ = "companion"
    __table_args__ = (UniqueConstraint("owner_id", name="uq_companion_owner"),)

    name: str = Field(default=COMPANION_NAME, max_length=40)
    # A short running summary of the conversation older than what each turn
    # sends word for word, and the newest message it covers.
    summary: str | None = Field(default=None, max_length=2000)
    summary_through: datetime | None = Field(default=None, sa_type=tstz())  # type: ignore


class CompanionMessage(OwnedRow, table=True):
    """``blocks`` are the typed render blocks (text, chart, insights, coach,
    plan, tracker, memory, chips)."""

    __tablename__ = "companion_message"
    __table_args__ = (enum_check("role", ("me", "sol"), name="ck_companion_msg_role"),)

    role: str = Field(sa_type=String(3))  # type: ignore
    text: str | None = Field(default=None, max_length=8000)
    blocks: list[dict[str, object]] = Field(default_factory=list, sa_type=JSONB)


class Tracker(OwnedRow, table=True):
    __tablename__ = "tracker"
    __table_args__ = (
        UniqueConstraint("owner_id", "metric", name="uq_tracker_metric"),
        enum_check("metric", METRICS, name="ck_tracker_metric"),
        CheckConstraint(
            "direction IS NULL OR direction IN ('below', 'above')",
            name="ck_tracker_direction",
        ),
    )

    metric: str = Field(sa_type=String(10))  # type: ignore
    label: str = Field(max_length=80)
    goal: float | None = Field(default=None, sa_type=Float)
    direction: str | None = Field(default=None, sa_type=String(5))  # type: ignore


# What a memory is about. response_style and profile are always in Fern's
# context (how to answer, who the person is); the rest is recalled when a
# question needs it.
MEMORY_KINDS = (
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
MEMORY_SOURCES = ("said", "inferred", "app")


class Memory(OwnedRow, table=True):
    """One thing Fern keeps about the person: an atomic statement, its kind,
    tags and importance, whether it is always in context, and its embedding
    for recall. A memory an update replaced keeps ``superseded_by``; only
    the newest of a chain is live."""

    __tablename__ = "memory"
    __table_args__ = (
        enum_check("kind", MEMORY_KINDS, name="ck_memory_kind"),
        enum_check("source", MEMORY_SOURCES, name="ck_memory_source"),
        CheckConstraint("importance BETWEEN 1 AND 5", name="ck_memory_importance"),
        Index(
            "ix_memory_embedding_hnsw",
            "embedding",
            postgresql_using="hnsw",
            postgresql_ops={"embedding": "vector_cosine_ops"},
        ),
        Index(
            "ix_memory_text_fts",
            text_sql("to_tsvector('simple', text)"),
            postgresql_using="gin",
        ),
    )

    text: str = Field(max_length=500)
    kind: str = Field(default="fact", sa_type=String(16))  # type: ignore
    tags: list[str] = Field(default_factory=list, sa_type=JSONB)
    importance: int = Field(default=3, sa_type=SmallInteger)
    always_on: bool = False
    source: str = Field(default="said", sa_type=String(10))  # type: ignore
    # sha256 of the normalised text: an exact repeat is caught without a
    # model call.
    text_hash: str | None = Field(default=None, sa_type=String(64), index=True)  # type: ignore
    embedding: list[float] | None = Field(
        default=None,
        sa_type=Vector(EMBEDDING_DIMENSIONS),  # type: ignore
    )
    embed_model: str | None = Field(default=None, sa_type=String(120))  # type: ignore
    last_used_at: datetime | None = Field(default=None, sa_type=tstz())  # type: ignore
    use_count: int = 0
    superseded_by: uuid.UUID | None = Field(
        default=None, foreign_key="memory.id", ondelete="SET NULL"
    )
