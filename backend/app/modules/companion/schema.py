"""Request and response schemas of the companion (Fern by default)."""

import uuid
from datetime import date, datetime
from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.modules.companion.models import METRICS

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


class MemorySync(BaseModel):
    text: Annotated[str, Field(min_length=1, max_length=500)] | None = None
