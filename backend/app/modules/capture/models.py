"""Capture, record cards, write log and journal (IA M5)."""

import uuid
from datetime import date, datetime

from sqlalchemy import CheckConstraint, Float, String, UniqueConstraint
from sqlmodel import Field

from app.shared.owned import JSONB, OwnedRow, enum_check, minor_check, tstz

CAPTURE_SOURCES = ("text", "voice", "photo", "file", "quick_add", "connector", "chat")
CAPTURE_STATUSES = (
    "queued",
    "processing",
    "needs_input",
    "done",
    "answered",
    "failed",
)
PHOTO_HINTS = ("auto", "meal", "receipt", "label", "statement", "whiteboard")
TARGETS = ("habits", "tasks", "fitness", "finance", "journal")
RECORD_KINDS = (
    "expense",
    "income",
    "transfer",
    "planned",
    "task",
    "taskComplete",
    "habitLog",
    "habitCreate",
    "routineStart",
    "workout",
    "weighIn",
    "meal",
    "journal",
    "photo",
    "command",
)
RULE_KEYS = (
    "habit",
    "task",
    "reminder",
    "workout",
    "weighIn",
    "meal",
    "expense",
    "income",
    "transfer",
    "journal",
    "structure",
)
CARD_STATES = ("proposed", "needs_input", "saved", "edited", "undone", "discarded")
WRITE_ACTIONS = ("proposed", "saved", "edited", "undone", "redone", "discarded")
REPLY_KINDS = ("answer", "info")


class Capture(OwnedRow, table=True):
    """One user input. ``client_uuid`` makes offline replay idempotent."""

    __tablename__ = "capture"
    __table_args__ = (
        UniqueConstraint("owner_id", "client_uuid", name="uq_capture_client_uuid"),
        enum_check("source", CAPTURE_SOURCES, name="ck_capture_source"),
        enum_check("status", CAPTURE_STATUSES, name="ck_capture_status"),
        CheckConstraint(
            "hint IS NULL OR hint IN ('auto','meal','receipt','label','statement','whiteboard')",
            name="ck_capture_hint",
        ),
    )

    client_uuid: uuid.UUID
    at: datetime = Field(sa_type=tstz(), index=True)  # type: ignore
    source: str = Field(default="text", sa_type=String(10))  # type: ignore
    text: str = Field(default="", max_length=8000)
    transcript: str | None = Field(default=None, max_length=20000)
    duration_sec: int | None = None
    hint: str | None = Field(default=None, sa_type=String(10))  # type: ignore
    file_name: str | None = Field(default=None, max_length=255)
    status: str = Field(default="queued", sa_type=String(12))  # type: ignore
    reply_text: str | None = Field(default=None, max_length=8000)
    error_code: str | None = Field(default=None, max_length=40)
    started_at: datetime | None = Field(default=None, sa_type=tstz())  # type: ignore
    # "ai" when a provider model interpreted it, "rules" for the fallback.
    engine: str | None = Field(default=None, max_length=8)


class CaptureAttachment(OwnedRow, table=True):
    __tablename__ = "capture_attachment"
    __table_args__ = (
        enum_check("kind", ("image", "audio", "file"), name="ck_capture_att_kind"),
    )

    capture_id: uuid.UUID = Field(
        foreign_key="capture.id", ondelete="CASCADE", index=True
    )
    media_id: uuid.UUID = Field(foreign_key="media_object.id", ondelete="CASCADE")
    kind: str = Field(sa_type=String(6))  # type: ignore


class RecordCard(OwnedRow, table=True):
    """A proposed write (IA "ProposedRecord"). ``refs`` are the ids of the
    rows the card wrote, so undo can delete exactly those."""

    __tablename__ = "record_card"
    __table_args__ = (
        enum_check("kind", RECORD_KINDS, name="ck_record_card_kind"),
        enum_check("target", TARGETS, name="ck_record_card_target"),
        enum_check("tier", ("auto", "confirm"), name="ck_record_card_tier"),
        enum_check("state", CARD_STATES, name="ck_record_card_state"),
        CheckConstraint(
            "confidence IS NULL OR (confidence >= 0 AND confidence <= 1)",
            name="ck_record_card_confidence",
        ),
    )

    capture_id: uuid.UUID = Field(
        foreign_key="capture.id", ondelete="CASCADE", index=True
    )
    position: int = 0
    kind: str = Field(sa_type=String(14))  # type: ignore
    target: str = Field(sa_type=String(8))  # type: ignore
    tier: str = Field(default="confirm", sa_type=String(8))  # type: ignore
    state: str = Field(default="proposed", sa_type=String(12))  # type: ignore
    payload: dict[str, object] = Field(sa_type=JSONB)
    refs: list[str] = Field(default_factory=list, sa_type=JSONB)
    ask: dict[str, object] | None = Field(default=None, sa_type=JSONB)
    note: str | None = Field(default=None, max_length=280)
    warn: str | None = Field(default=None, max_length=280)
    confidence: float | None = Field(default=None, sa_type=Float)
    day_offset: int | None = None
    # Before-image of an edited/deleted target, for undo of a command card.
    prior: dict[str, object] | None = Field(default=None, sa_type=JSONB)


class CardWriteLog(OwnedRow, table=True):
    """Append-only: who did what to a card and when (IA "WriteLog")."""

    __tablename__ = "card_write_log"
    __table_args__ = (
        enum_check("action", WRITE_ACTIONS, name="ck_card_log_action"),
        enum_check("actor", ("ai", "user", "connector"), name="ck_card_log_actor"),
    )

    card_id: uuid.UUID = Field(
        foreign_key="record_card.id", ondelete="CASCADE", index=True
    )
    at: datetime = Field(sa_type=tstz())  # type: ignore
    action: str = Field(sa_type=String(10))  # type: ignore
    actor: str = Field(sa_type=String(10))  # type: ignore
    before: dict[str, object] | None = Field(default=None, sa_type=JSONB)
    after: dict[str, object] | None = Field(default=None, sa_type=JSONB)


class ReplyItem(OwnedRow, table=True):
    """Answer and info cards: read-only presentation, stored whole."""

    __tablename__ = "reply_item"
    __table_args__ = (enum_check("kind", REPLY_KINDS, name="ck_reply_item_kind"),)

    capture_id: uuid.UUID = Field(
        foreign_key="capture.id", ondelete="CASCADE", index=True
    )
    position: int = 0
    kind: str = Field(sa_type=String(8))  # type: ignore
    body: dict[str, object] = Field(sa_type=JSONB)


class JournalEntry(OwnedRow, table=True):
    __tablename__ = "journal_entry"
    __table_args__ = (
        enum_check("source", ("voice", "text", "wrapup"), name="ck_journal_source"),
        CheckConstraint("mood IS NULL OR mood BETWEEN 1 AND 5", name="ck_journal_mood"),
    )

    day: date = Field(index=True)
    body: str = Field(max_length=20000)
    source: str = Field(default="text", sa_type=String(8))  # type: ignore
    capture_id: uuid.UUID | None = Field(
        default=None, foreign_key="capture.id", ondelete="SET NULL"
    )
    mood: int | None = None
    tags: list[str] = Field(default_factory=list, sa_type=JSONB)
    area: str | None = Field(default=None, max_length=40)
    private: bool = False
    transcript: str | None = Field(default=None, max_length=20000)


class AISettings(OwnedRow, table=True):
    """Auto-save policy (OQ-CAP-1, the single policy per IA ruling X-6),
    spend cap and data scope."""

    __tablename__ = "ai_settings"
    __table_args__ = (
        UniqueConstraint("owner_id", name="uq_ai_settings_owner"),
        enum_check("language", ("en-tl", "en"), name="ck_ai_language"),
        enum_check("transcription", ("server", "browser"), name="ck_ai_transcription"),
        enum_check("finance_scope", ("aggregates", "records"), name="ck_ai_fin_scope"),
        minor_check("money_threshold_minor", name="ck_ai_money_threshold"),
        minor_check("spend_cap_minor", name="ck_ai_spend_cap"),
        CheckConstraint("retention_days BETWEEN 1 AND 3650", name="ck_ai_retention"),
    )

    rules: dict[str, str] = Field(default_factory=dict, sa_type=JSONB)
    money_threshold_minor: int = Field(default=100_000)
    language: str = Field(default="en-tl", sa_type=String(5))  # type: ignore
    transcription: str = Field(default="server", sa_type=String(8))  # type: ignore
    send_photos: bool = True
    journal_in_qa: bool = False
    finance_scope: str = Field(default="aggregates", sa_type=String(10))  # type: ignore
    spend_cap_minor: int = Field(default=50_000)
    ai_enabled: bool = True
    retention_days: int = 30
    # The model the server's own key answers this user with, from the Nebius
    # catalogue (app.modules.ai_providers.catalog); None: the server default.
    model: str | None = Field(default=None, sa_type=String(160))  # type: ignore
