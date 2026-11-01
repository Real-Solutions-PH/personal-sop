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
from sqlmodel import Field, SQLModel

from app.modules.ai_providers.public import EMBEDDING_DIMENSIONS
from app.modules.companion.defaults import COMPANION_NAME
from app.shared.owned import JSONB, OwnedRow, enum_check, tstz, utcnow

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


class CompanionThread(OwnedRow, table=True):
    """One chat with Fern. A new chat starts with a clean context: the model
    sees this thread's messages and its own running summary, nothing from
    the others (memories and today's facts still apply everywhere). The id
    comes from the phone, so a chat can begin offline."""

    __tablename__ = "companion_thread"

    # From the first message unless the person renames it.
    title: str | None = Field(default=None, max_length=80)
    last_at: datetime | None = Field(default=None, sa_type=tstz(), index=True)  # type: ignore
    summary: str | None = Field(default=None, max_length=2000)
    summary_through: datetime | None = Field(default=None, sa_type=tstz())  # type: ignore


class CompanionMessage(OwnedRow, table=True):
    """``blocks`` are the typed render blocks (text, chart, insights, coach,
    plan, tracker, memory, chips)."""

    __tablename__ = "companion_message"
    __table_args__ = (enum_check("role", ("me", "sol"), name="ck_companion_msg_role"),)

    thread_id: uuid.UUID | None = Field(
        default=None, foreign_key="companion_thread.id", ondelete="CASCADE", index=True
    )

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


# How a person told Fern a reply was good or bad: a thumb on the reply, or
# a signal read from what they did next (a correction, frustration, or
# undoing what the reply logged). Implicit signals are always "down".
FEEDBACK_KINDS = ("thumb", "correction", "frustration", "undo")
FEEDBACK_RATINGS = ("up", "down")
FEEDBACK_REASONS = ("wrong", "too_long", "missed", "slow", "other")


class FernFeedback(OwnedRow, table=True):
    """One signal about one Fern reply. A thumb is one per reply (changing
    it updates the row); each implicit kind is recorded once per reply.

    ``said`` keeps the person's own words that carried an implicit signal,
    for their own memory; it never leaves their rows. The shared layer
    (:class:`FernRule`) only ever receives a de-identified generalisation
    (``feedback.propose``). ``digested`` marks a signal already learned from."""

    __tablename__ = "fern_feedback"
    __table_args__ = (
        UniqueConstraint(
            "owner_id", "message_id", "kind", name="uq_fern_feedback_kind"
        ),
        enum_check("kind", FEEDBACK_KINDS, name="ck_fern_feedback_kind"),
        enum_check("rating", FEEDBACK_RATINGS, name="ck_fern_feedback_rating"),
        CheckConstraint(
            "reason IS NULL OR reason IN ("
            + ", ".join(f"'{r}'" for r in FEEDBACK_REASONS)
            + ")",
            name="ck_fern_feedback_reason",
        ),
    )

    message_id: uuid.UUID = Field(
        foreign_key="companion_message.id", ondelete="CASCADE", index=True
    )
    kind: str = Field(sa_type=String(12))  # type: ignore
    rating: str = Field(sa_type=String(4))  # type: ignore
    reason: str | None = Field(default=None, sa_type=String(10))  # type: ignore
    note: str | None = Field(default=None, max_length=280)
    said: str | None = Field(default=None, max_length=500)
    digested: bool = False


# A rule for every Fern, learned from many people's feedback.
RULE_STATUSES = ("proposed", "approved", "rejected")


class FernRule(SQLModel, table=True):
    """A generalised behaviour or format rule for Fern ("when asked for
    portions, give grams per food and the macros left"), shared by every
    user. Not owned and not tenant-scoped: it holds no personal data by
    construction (``feedback.propose`` writes only text that passed the
    de-identification check). ``evidence`` counts the signals behind it and
    ``users`` the distinct people (counted through :class:`FernRuleVote`,
    which keeps only a keyed hash of who). Fern follows a rule once it is
    approved, or past the automatic threshold (``feedback.active_rules``)."""

    __tablename__ = "fern_rule"
    __table_args__ = (
        UniqueConstraint("text_hash", name="uq_fern_rule_text"),
        enum_check("status", RULE_STATUSES, name="ck_fern_rule_status"),
        CheckConstraint("evidence >= 0 AND users >= 0", name="ck_fern_rule_counts"),
    )

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    text: str = Field(max_length=300)
    text_hash: str = Field(sa_type=String(64))  # type: ignore
    status: str = Field(default="proposed", sa_type=String(10))  # type: ignore
    evidence: int = 0
    users: int = 0
    embedding: list[float] | None = Field(
        default=None,
        sa_type=Vector(EMBEDDING_DIMENSIONS),  # type: ignore
    )
    embed_model: str | None = Field(default=None, sa_type=String(120))  # type: ignore
    created_at: datetime = Field(default_factory=utcnow, sa_type=tstz())  # type: ignore
    updated_at: datetime = Field(default_factory=utcnow, sa_type=tstz())  # type: ignore
    decided_at: datetime | None = Field(default=None, sa_type=tstz())  # type: ignore


class FernRuleVote(SQLModel, table=True):
    """One person's support for a rule, so ``FernRule.users`` counts people,
    not signals. ``voter`` is an HMAC of the user id under the server's
    secret: countable, not reversible, and never joined to a user."""

    __tablename__ = "fern_rule_vote"
    __table_args__ = (UniqueConstraint("rule_id", "voter", name="uq_fern_rule_vote"),)

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    rule_id: uuid.UUID = Field(
        foreign_key="fern_rule.id", ondelete="CASCADE", index=True
    )
    voter: str = Field(sa_type=String(64))  # type: ignore
    count: int = 1
    created_at: datetime = Field(default_factory=utcnow, sa_type=tstz())  # type: ignore
