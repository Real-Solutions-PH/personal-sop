"""Request and response schemas of the capture module (captures, record
cards, the journal and AI settings). Table models never leave the module."""

import uuid
from datetime import date, datetime
from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.modules.ai_providers import catalog
from app.modules.capture.rules import RULE_KEYS
from app.shared.money import MAX_MINOR

Source = Literal["text", "voice", "photo", "file", "quick_add", "connector"]
Hint = Literal["auto", "meal", "receipt", "label", "statement", "whiteboard"]
Minor = Annotated[int, Field(ge=1, le=MAX_MINOR)]
Day = Annotated[int, Field(ge=-366, le=0)]
Text = Annotated[str, Field(max_length=8000)]
Short = Annotated[str, Field(min_length=1, max_length=120)]
Id = Annotated[str, Field(min_length=1, max_length=64)]


# ---------------------------------------------------------------- payloads
# One schema per record kind: what an edit may set. Ids are strings because
# a card may point at a row of any module (the owning module validates it).


class _P(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ExpensePayload(_P):
    kind: Literal["expense"]
    amount_minor: Minor
    category_id: Id | None = None
    account_id: Id | None = None
    payee: Annotated[str, Field(max_length=120)] | None = None
    note: Annotated[str, Field(max_length=280)] | None = None
    currency: Annotated[str, Field(max_length=3)] | None = None
    from_receipt: bool | None = None


class IncomePayload(_P):
    kind: Literal["income"]
    amount_minor: Minor
    category_id: Id | None = None
    account_id: Id | None = None
    payee: Annotated[str, Field(max_length=120)] | None = None


class TransferPayload(_P):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)
    kind: Literal["transfer"]
    amount_minor: Minor
    from_: Id | None = Field(default=None, alias="from")
    to: Id | None = None


class PlannedPayload(_P):
    kind: Literal["planned"]
    name: Short
    amount_minor: Minor
    day: Annotated[int, Field(ge=1, le=31)]
    account_id: Id | None = None
    category_id: Id | None = None


class TaskDraftIn(_P):
    title: Annotated[str, Field(min_length=1, max_length=280)]
    list_id: Id | None = None
    due_date: date | None = None
    due_time: Annotated[str, Field(pattern=r"^([01]\d|2[0-3]):[0-5]\d$")] | None = None
    remind: bool = False
    tags: list[Annotated[str, Field(max_length=40)]] = Field(
        default_factory=list, max_length=8
    )


class TaskPayload(_P):
    kind: Literal["task"]
    tasks: list[TaskDraftIn] = Field(min_length=1, max_length=50)


class TaskCompletePayload(_P):
    kind: Literal["taskComplete"]
    task_id: Id | None = None
    query: Annotated[str, Field(max_length=280)] = ""


class HabitLogPayload(_P):
    kind: Literal["habitLog"]
    habit_id: Id
    value: Annotated[float, Field(ge=0, le=100000)] | None = None
    add: bool | None = None


class HabitCreatePayload(_P):
    kind: Literal["habitCreate"]
    name: Annotated[str, Field(min_length=1, max_length=80)]
    icon: Annotated[str, Field(max_length=32)] = "✅"
    type: Literal["check", "duration", "count"] = "check"
    target: Annotated[float, Field(gt=0, le=100000)] | None = None
    unit: Annotated[str, Field(max_length=16)] | None = None
    days: list[Annotated[int, Field(ge=0, le=6)]] = Field(
        default_factory=lambda: [0, 1, 2, 3, 4, 5, 6], max_length=7
    )
    time: Annotated[str, Field(pattern=r"^([01]\d|2[0-3]):[0-5]\d$")] | None = None
    log_today: bool | None = None


class RoutineStartPayload(_P):
    kind: Literal["routineStart"]
    routine_id: Id | None = None
    query: Annotated[str, Field(max_length=280)] = ""


class SetIn(_P):
    reps: Annotated[int, Field(ge=0, le=1000)]
    weight: Annotated[float, Field(ge=0, le=2000)]


class ExerciseIn(_P):
    exercise: Annotated[str, Field(min_length=1, max_length=80)]
    sets: list[SetIn] = Field(max_length=50)


class CardioIn(_P):
    km: Annotated[float, Field(ge=0, le=1000)] | None = None
    min: Annotated[float, Field(ge=0, le=1440)] | None = None
    activity: Annotated[str, Field(max_length=40)] = "Run"


class WorkoutPayload(_P):
    kind: Literal["workout"]
    name: Annotated[str, Field(min_length=1, max_length=120)]
    exercises: list[ExerciseIn] = Field(default_factory=list, max_length=40)
    cardio: CardioIn | None = None
    new_exercises: list[str] | None = None


class WeighInPayload(_P):
    kind: Literal["weighIn"]
    kg: Annotated[float, Field(gt=0, le=500)]
    body_fat_pct: Annotated[float | None, Field(gt=0, lt=100)] = None
    prev_kg: float | None = None


class MealItemIn(_P):
    name: Annotated[str, Field(min_length=1, max_length=120)]
    qty: Annotated[float, Field(ge=0, le=10000)]
    unit: Annotated[str, Field(max_length=24)]
    kcal: Annotated[float, Field(ge=0, le=20000)]
    protein: Annotated[float, Field(ge=0, le=2000)]
    carbs: Annotated[float, Field(ge=0, le=2000)]
    fat: Annotated[float, Field(ge=0, le=2000)]
    assumption: Annotated[str, Field(max_length=200)] | None = None
    # Optional detail: grams; sodium in milligrams.
    fiber: Annotated[float, Field(ge=0, le=2000)] | None = None
    sat_fat: Annotated[float, Field(ge=0, le=2000)] | None = None
    sugar: Annotated[float, Field(ge=0, le=2000)] | None = None
    sodium: Annotated[float, Field(ge=0, le=100000)] | None = None


class MealPayload(_P):
    kind: Literal["meal"]
    raw: Annotated[str, Field(max_length=2000)] = ""
    label: Literal["breakfast", "lunch", "dinner", "snack"] | None = None
    items: list[MealItemIn] = Field(max_length=40)
    confidence: Annotated[float, Field(ge=0, le=1)] = 0.5
    from_photo: bool | None = None


class JournalPayload(_P):
    kind: Literal["journal"]
    body: Annotated[str, Field(min_length=1, max_length=20000)]
    mood: Annotated[int, Field(ge=1, le=5)] | None = None
    area: Annotated[str, Field(max_length=40)] | None = None
    tags: list[Annotated[str, Field(max_length=40)]] = Field(
        default_factory=list, max_length=20
    )
    transcript: Annotated[str, Field(max_length=20000)] | None = None


class PhotoPayload(_P):
    kind: Literal["photo"]
    caption: Annotated[str, Field(max_length=2000)] = ""


class CommandPayload(_P):
    kind: Literal["command"]
    op: Literal["edit", "delete"]
    record_id: Id | None = None
    amount_minor: Minor | None = None


Payload = Annotated[
    ExpensePayload
    | IncomePayload
    | TransferPayload
    | PlannedPayload
    | TaskPayload
    | TaskCompletePayload
    | HabitLogPayload
    | HabitCreatePayload
    | RoutineStartPayload
    | WorkoutPayload
    | WeighInPayload
    | MealPayload
    | JournalPayload
    | PhotoPayload
    | CommandPayload,
    Field(discriminator="kind"),
]


class PayloadIn(BaseModel):
    payload: Payload


def dump_payload(p: BaseModel) -> dict[str, Any]:
    return p.model_dump(mode="json", by_alias=True, exclude_none=True)


# ---------------------------------------------------------------- captures


class CaptureIn(BaseModel):
    """``POST /capture``: idempotent on ``client_uuid`` (an offline replay
    returns the capture it already made)."""

    id: uuid.UUID | None = None
    client_uuid: uuid.UUID
    at: datetime | None = None
    source: Source = "text"
    text: Text = ""
    transcript: Annotated[str, Field(max_length=20000)] | None = None
    duration_sec: Annotated[int, Field(ge=0, le=3600)] | None = None
    hint: Hint | Literal["journal", "expense", "task", "weigh-in"] | None = None
    file_name: Annotated[str, Field(max_length=255)] | None = None
    media_id: uuid.UUID | None = None
    # More photos read together with ``media_id`` (one capture, one answer).
    extra_media_ids: list[uuid.UUID] = Field(default_factory=list, max_length=9)
    # A statement file needs the account it belongs to (CAP-04).
    account_id: uuid.UUID | None = None
    # Store only; the device asks the server to process it later (CAP-14).
    queue_only: bool = False

    @field_validator("at")
    @classmethod
    def _aware(cls, v: datetime | None) -> datetime | None:
        if v is not None and v.tzinfo is None:
            raise ValueError("at must carry a time zone")
        return v


class RerunIn(BaseModel):
    text: Text | None = None


class AnswerIn(BaseModel):
    value: Annotated[str, Field(min_length=1, max_length=200)]


class QuickAddIn(BaseModel):
    """CAP-10: a hand-entered record, saved at once (still undoable)."""

    client_uuid: uuid.UUID
    text: Annotated[str, Field(max_length=280)] = ""
    payload: Payload


class AttachmentPublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    capture_id: uuid.UUID
    media_id: uuid.UUID
    kind: str
    version: int = 0
    deleted_at: datetime | None = None


class WriteLogPublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    at: datetime
    action: str
    actor: str


class CardPublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    t: Literal["record"] = "record"
    id: uuid.UUID
    capture_id: uuid.UUID
    position: int
    kind: str
    target: str
    tier: str
    state: str
    payload: dict[str, Any]
    refs: list[str]
    ask: dict[str, Any] | None
    note: str | None
    warn: str | None
    confidence: float | None
    day_offset: int | None
    version: int
    log: list[WriteLogPublic] = Field(default_factory=list)


class ReplyPublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    capture_id: uuid.UUID
    position: int
    kind: str
    body: dict[str, Any]
    version: int = 0
    deleted_at: datetime | None = None


class CapturePublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    client_uuid: uuid.UUID
    at: datetime
    source: str
    text: str
    transcript: str | None
    duration_sec: int | None
    hint: str | None
    file_name: str | None
    status: str
    reply_text: str | None
    error_code: str | None
    started_at: datetime | None
    engine: str | None
    created_at: datetime
    version: int
    deleted_at: datetime | None = None


class CaptureDetail(CapturePublic):
    cards: list[CardPublic] = Field(default_factory=list)
    replies: list[ReplyPublic] = Field(default_factory=list)
    attachments: list[AttachmentPublic] = Field(default_factory=list)


class CapturesPublic(BaseModel):
    data: list[CaptureDetail]
    count: int


class Count(BaseModel):
    count: int


# ---------------------------------------------------------------- journal


class JournalIn(BaseModel):
    id: uuid.UUID | None = None
    body: Annotated[str, Field(min_length=1, max_length=20000)]
    day: date | None = None
    source: Literal["voice", "text", "wrapup"] = "text"
    mood: Annotated[int, Field(ge=1, le=5)] | None = None
    tags: list[Annotated[str, Field(max_length=40)]] = Field(
        default_factory=list, max_length=20
    )
    area: Annotated[str, Field(max_length=40)] | None = None
    private: bool = True
    transcript: Annotated[str, Field(max_length=20000)] | None = None


class JournalUpdate(BaseModel):
    body: Annotated[str, Field(min_length=1, max_length=20000)] | None = None
    day: date | None = None
    mood: Annotated[int, Field(ge=1, le=5)] | None = None
    tags: list[Annotated[str, Field(max_length=40)]] | None = Field(
        default=None, max_length=20
    )
    area: Annotated[str, Field(max_length=40)] | None = None
    private: bool | None = None
    transcript: Annotated[str, Field(max_length=20000)] | None = None


class JournalPublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    day: date
    body: str
    source: str
    capture_id: uuid.UUID | None
    mood: int | None
    tags: list[str]
    area: str | None
    private: bool
    transcript: str | None
    created_at: datetime
    version: int
    deleted_at: datetime | None = None


class JournalsPublic(BaseModel):
    data: list[JournalPublic]
    count: int
    streak: int


# ---------------------------------------------------------------- settings

Rules = dict[str, Literal["auto", "confirm"]]


class AISettingsUpdate(BaseModel):
    rules: Rules | None = None
    money_threshold_minor: Annotated[int, Field(ge=0, le=MAX_MINOR)] | None = None
    language: Literal["en-tl", "en"] | None = None
    transcription: Literal["server", "browser"] | None = None
    send_photos: bool | None = None
    journal_in_qa: bool | None = None
    finance_scope: Literal["aggregates", "records"] | None = None
    spend_cap_minor: Annotated[int, Field(ge=0, le=MAX_MINOR)] | None = None
    ai_enabled: bool | None = None
    retention_days: Annotated[int, Field(ge=1, le=3650)] | None = None
    model: str | None = None

    @field_validator("model")
    @classmethod
    def _offered_model(cls, v: str | None) -> str | None:
        if v is not None and v not in catalog.NEBIUS_IDS:
            raise ValueError("not a model the app offers")
        return v

    @field_validator("rules")
    @classmethod
    def _known_rules(cls, v: Rules | None) -> Rules | None:
        if v is not None and any(k not in RULE_KEYS for k in v):
            raise ValueError("unknown record type")
        return v


class AISettingsPublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    rules: dict[str, str]
    money_threshold_minor: int
    language: str
    transcription: str
    send_photos: bool
    journal_in_qa: bool
    finance_scope: str
    spend_cap_minor: int
    ai_enabled: bool
    retention_days: int
    model: str | None = None
    version: int
    # The meter (ai_providers.public.budget), read-only.
    spend_minor: int = 0
    calls: int = 0


class DictationOut(BaseModel):
    """``POST /capture/dictate``: what was said."""

    text: str
