"""Request and response schemas of the companion (Fern by default)."""

import uuid
from datetime import date, datetime
from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.modules.companion.models import MEMORY_KINDS, METRICS

Metric = Literal[
    "life",
    "habits",
    "tasks",
    "spend",
    "spendCats",
    "netWorth",
    "workouts",
    "weight",
    "nutrition",
]
assert set(METRICS) == set(Metric.__args__)  # type: ignore[attr-defined]


class AskIn(BaseModel):
    text: Annotated[str, Field(max_length=4000)] = ""
    # The device mints the user message's id: a replayed ask answers once.
    id: uuid.UUID | None = None
    hint: Annotated[str, Field(max_length=20)] | None = None
    # Photos sent with the message (uploaded to media first).
    media_ids: list[uuid.UUID] = Field(default_factory=list, max_length=10)
    # The chat it belongs to; the device mints a new chat's id. Omitted: the
    # most recent chat (an app from before chats).
    thread_id: uuid.UUID | None = None

    @model_validator(mode="after")
    def _something(self) -> "AskIn":
        if not self.text.strip() and not self.media_ids:
            raise ValueError("Type a message or attach a photo")
        return self


class MessagePublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    role: str
    text: str | None
    blocks: list[dict[str, Any]]
    created_at: datetime
    version: int
    deleted_at: datetime | None = None
    thread_id: uuid.UUID | None = None


class ThreadSync(BaseModel):
    """A chat as the app writes it: its title (renaming); a new id makes it."""

    title: Annotated[str, Field(max_length=80)] | None = None


class ThreadPublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    title: str | None
    last_at: datetime | None
    created_at: datetime
    version: int
    deleted_at: datetime | None = None


class MessagesPublic(BaseModel):
    data: list[MessagePublic]
    count: int


class AskOut(BaseModel):
    """A reply (``me`` + ``sol`` messages) or, for a log, the capture it
    became (the chat shows captures in line with messages)."""

    kind: Literal["reply", "capture"]
    engine: Literal["ai", "rules"]
    messages: list[MessagePublic] = Field(default_factory=list)
    capture: dict[str, Any] | None = None


class ReplyOut(BaseModel):
    """Where the reply to a question stands, for an app that lost its
    stream: ``done`` with the stored question and reply (or the capture a
    log became), ``running`` while the turn is still being written, or
    ``failed`` when it ended with nothing stored."""

    status: Literal["running", "done", "failed"]
    messages: list[MessagePublic] = Field(default_factory=list)
    capture: dict[str, Any] | None = None


class TrackerIn(BaseModel):
    label: Annotated[str, Field(min_length=1, max_length=80)] | None = None
    goal: Annotated[float, Field(gt=0, le=1e12)] | None = None
    direction: Literal["below", "above"] | None = None


class TrackerPublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    metric: str
    label: str
    goal: float | None
    direction: str | None
    created_at: datetime
    version: int
    deleted_at: datetime | None = None


class MemoryIn(BaseModel):
    id: uuid.UUID | None = None
    text: Annotated[str, Field(min_length=1, max_length=500)]


class MemoryPublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    text: str
    kind: str = "fact"
    tags: list[str] = []
    importance: int = 3
    always_on: bool = False
    source: str = "said"
    created_at: datetime
    version: int
    deleted_at: datetime | None = None


class CompanionPublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    name: str
    version: int
    deleted_at: datetime | None = None


class CompanionState(BaseModel):
    name: str
    trackers: list[TrackerPublic]
    memories: list[MemoryPublic]


class RenameIn(BaseModel):
    name: Annotated[str, Field(max_length=40)]


class Point(BaseModel):
    day: date
    value: float | None


class SeriesOut(BaseModel):
    metric: str
    label: str
    days: int
    points: list[Point]


class Insight(BaseModel):
    accent: str
    title: str
    body: str
    track: str | None = None
    href: str | None = None


class InsightsOut(BaseModel):
    data: list[Insight]


# Sync payloads: every field optional (field-level last-writer-wins).
class CompanionSync(BaseModel):
    name: Annotated[str, Field(max_length=40)] | None = None


class TrackerSync(BaseModel):
    metric: Metric | None = None
    label: Annotated[str, Field(min_length=1, max_length=80)] | None = None
    goal: Annotated[float, Field(gt=0, le=1e12)] | None = None
    direction: Literal["below", "above"] | None = None


MemoryKind = Literal[
    "response_style",
    "preference",
    "profile",
    "fact",
    "goal",
    "relationship",
    "health",
    "routine",
    "event",
]
assert set(MEMORY_KINDS) == set(MemoryKind.__args__)  # type: ignore[attr-defined]


class MemorySync(BaseModel):
    text: Annotated[str, Field(min_length=1, max_length=500)] | None = None
    kind: MemoryKind | None = None
    tags: (
        Annotated[
            list[Annotated[str, Field(max_length=30)]],
            Field(max_length=8),
        ]
        | None
    ) = None
    importance: Annotated[int, Field(ge=1, le=5)] | None = None
    always_on: bool | None = None


# ---------------------------------------------------------------- feedback

FeedbackRating = Literal["up", "down"]
FeedbackReason = Literal["wrong", "too_long", "missed", "slow", "other"]
RuleStatus = Literal["proposed", "approved", "rejected"]


class FeedbackIn(BaseModel):
    """A thumb on a Fern reply; ``rating: null`` takes it back. ``reason``
    and ``note`` are kept only with a thumbs-down."""

    rating: FeedbackRating | None
    reason: FeedbackReason | None = None
    note: Annotated[str, Field(max_length=280)] | None = None


class FeedbackPublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    message_id: uuid.UUID
    rating: FeedbackRating
    reason: FeedbackReason | None
    note: str | None


class FernRulePublic(BaseModel):
    """A rule learned for every Fern: its text and how much stands behind
    it (signals, distinct people). Holds no personal data."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    text: str
    status: RuleStatus
    evidence: int
    users: int
    created_at: datetime
    updated_at: datetime
    decided_at: datetime | None


class FernRuleDecision(BaseModel):
    status: RuleStatus
    text: Annotated[str, Field(min_length=10, max_length=200)] | None = None
