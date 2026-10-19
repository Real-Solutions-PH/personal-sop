"""Sync registrations for the capture module (entities + domain actions).

Devices push the RAW capture (an offline replay); the server interprets it
and devices pull the cards and replies it produced (read-only entities).
Card decisions are actions, never field writes, so a synced confirm or undo
writes and removes module rows through the same rules as REST.

Inside a sync batch ``ctx.commit()`` only flushes: a capture the AI switch
or spend cap refuses is kept as ``failed`` here instead of raising, so the
refusal never rolls the stored input back.
"""

import uuid
from datetime import date, datetime
from typing import Annotated, Any, Literal

from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict, Field, ValidationError

from app.modules.capture import cards as C
from app.modules.capture import engine, journal
from app.modules.capture.models import (
    AISettings,
    Capture,
    CaptureAttachment,
    CardWriteLog,
    JournalEntry,
    RecordCard,
    ReplyItem,
)
from app.modules.capture.schema import (
    AISettingsPublic,
    AISettingsUpdate,
    AttachmentPublic,
    CaptureIn,
    CapturePublic,
    JournalPublic,
    PayloadIn,
    ReplyPublic,
    Source,
    dump_payload,
)
from app.modules.sync.registry import Action, Entity, Registry
from app.shared import owned_repo
from app.shared.context import Ctx
from app.shared.domain import invalid
from app.shared.owned import OwnedRow


class CaptureSync(BaseModel):
    client_uuid: uuid.UUID | None = None
    at: datetime | None = None
    source: Source | None = None
    text: Annotated[str, Field(max_length=8000)] | None = None
    transcript: Annotated[str, Field(max_length=20000)] | None = None
    duration_sec: Annotated[int, Field(ge=0, le=3600)] | None = None
    hint: Annotated[str, Field(max_length=10)] | None = None
    file_name: Annotated[str, Field(max_length=255)] | None = None
    media_id: uuid.UUID | None = None
    account_id: uuid.UUID | None = None


class JournalSync(BaseModel):
    day: date | None = None
    body: Annotated[str, Field(min_length=1, max_length=20000)] | None = None
    source: Literal["voice", "text", "wrapup"] | None = None
    mood: Annotated[int, Field(ge=1, le=5)] | None = None
    tags: list[Annotated[str, Field(max_length=40)]] | None = Field(
        default=None, max_length=20
    )
    area: Annotated[str, Field(max_length=40)] | None = None
    private: bool | None = None
    transcript: Annotated[str, Field(max_length=20000)] | None = None


class CardSyncPublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)
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
    deleted_at: datetime | None = None


class WriteLogSyncPublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    card_id: uuid.UUID
    at: datetime
    action: str
    actor: str
    version: int
    deleted_at: datetime | None = None


class CardArgs(BaseModel):
    card_id: uuid.UUID


class AnswerArgs(BaseModel):
    card_id: uuid.UUID
    value: Annotated[str, Field(min_length=1, max_length=200)]


class EditArgs(BaseModel):
    card_id: uuid.UUID
    payload: dict[str, Any]


class CaptureArgs(BaseModel):
    capture_id: uuid.UUID


# ---------------------------------------------------------------- entities


def upsert_capture(ctx: Ctx, capture_id: uuid.UUID, payload: BaseModel) -> OwnedRow:
    data = payload.model_dump(exclude_unset=True)
    existing = owned_repo.get(ctx, Capture, capture_id, include_deleted=True)
    if existing is not None:
        # A queued or failed capture's text/transcript may still be corrected
        # from the device; anything already read is the server's.
        if existing.status in ("queued", "failed"):
            for k in ("text", "transcript"):
                if data.get(k) is not None:
                    setattr(existing, k, str(data[k]).strip())
            ctx.session.add(existing)
            ctx.session.flush()
        ctx.commit()
        return existing
    try:
        data_in = CaptureIn(
            id=capture_id,
            client_uuid=data.get("client_uuid") or capture_id,
            **{
                k: v
                for k, v in data.items()
                if k not in ("client_uuid",) and v is not None
            },
        )
    except ValidationError:
        raise invalid("capture_invalid", "That capture can't be stored") from None
    out = engine.submit(ctx, data_in)
    if out.created:
        try:
            engine.process(ctx, out.capture)
        except HTTPException:
            pass  # kept as "failed" with its error card (see module docstring)
    ctx.commit()
    return out.capture


def delete_capture(ctx: Ctx, capture_id: uuid.UUID) -> None:
    engine._tombstone(ctx, C.require_capture(ctx, capture_id))
    ctx.commit()


def upsert_journal(ctx: Ctx, entry_id: uuid.UUID, payload: BaseModel) -> OwnedRow:
    data = payload.model_dump(exclude_unset=True)
    row = owned_repo.get(ctx, JournalEntry, entry_id, include_deleted=True)
    if row is None:
        row = journal.add_entry(
            ctx,
            body=data["body"],
            day=data.get("day"),
            source=data.get("source") or "text",
            mood=data.get("mood"),
            tags=data.get("tags"),
            area=data.get("area"),
            private=True if data.get("private") is None else bool(data["private"]),
            transcript=data.get("transcript"),
            entry_id=entry_id,
        )
    else:
        before = row.day
        owned_repo.apply(row, {k: v for k, v in data.items() if k != "source"})
        ctx.session.add(row)
        ctx.session.flush()
        journal._dirty(ctx, before)
        journal._dirty(ctx, row.day)
    ctx.commit()
    return row


def delete_journal(ctx: Ctx, entry_id: uuid.UUID) -> None:
    journal.delete_entry_row(ctx, entry_id)
    ctx.commit()


def upsert_settings(ctx: Ctx, row_id: uuid.UUID, payload: BaseModel) -> OwnedRow:
    # One row per user: whatever id the device minted, the op lands on it.
    del row_id
    row = journal.patch_settings_row(ctx, payload.model_dump(exclude_unset=True))
    ctx.commit()
    return row


def reset_settings(ctx: Ctx, row_id: uuid.UUID) -> None:
    del row_id
    from app.modules.capture.rules import DEFAULT_MONEY_THRESHOLD_MINOR, DEFAULT_RULES

    journal.patch_settings_row(
        ctx,
        {
            "rules": dict(DEFAULT_RULES),
            "money_threshold_minor": DEFAULT_MONEY_THRESHOLD_MINOR,
        },
    )
    ctx.commit()


# ---------------------------------------------------------------- actions


def _card_out(ctx: Ctx, card: RecordCard) -> dict[str, Any]:
    return engine.card_public(ctx, card).model_dump(mode="json")


def _confirm(ctx: Ctx, args: dict[str, Any]) -> dict[str, Any]:
    card = C.confirm(ctx, card_id=args["card_id"])
    return {"card": _card_out(ctx, card)}


def _confirm_all(ctx: Ctx, args: dict[str, Any]) -> dict[str, Any]:
    out = C.confirm_all(ctx, capture_id=args["capture_id"])
    return {"cards": [_card_out(ctx, c) for c in out]}


def _discard(ctx: Ctx, args: dict[str, Any]) -> dict[str, Any]:
    return {"card": _card_out(ctx, C.discard(ctx, card_id=args["card_id"]))}


def _undo(ctx: Ctx, args: dict[str, Any]) -> dict[str, Any]:
    card = C.undo_row(ctx, C.require_card(ctx, args["card_id"]))
    ctx.commit()
    return {"card": _card_out(ctx, card)}


def _redo(ctx: Ctx, args: dict[str, Any]) -> dict[str, Any]:
    card = C.redo_row(ctx, C.require_card(ctx, args["card_id"]))
    ctx.commit()
    return {"card": _card_out(ctx, card)}


def _answer(ctx: Ctx, args: dict[str, Any]) -> dict[str, Any]:
    out = C.answer(ctx, card_id=args["card_id"], value=args["value"])
    return {
        "card": _card_out(ctx, out.card),
        "replaced_by": [_card_out(ctx, c) for c in out.replaced],
    }


def _edit(ctx: Ctx, args: dict[str, Any]) -> dict[str, Any]:
    p = PayloadIn.model_validate({"payload": args["payload"]})
    card = C.edit(ctx, card_id=args["card_id"], payload=dump_payload(p.payload))
    return {"card": _card_out(ctx, card)}


def _skip(ctx: Ctx, args: dict[str, Any]) -> dict[str, Any]:
    return {"card": _card_out(ctx, C.skip(ctx, card_id=args["card_id"]))}


def _retry(ctx: Ctx, args: dict[str, Any]) -> dict[str, Any]:
    try:
        cap = engine.retry(ctx, capture_id=args["capture_id"])
    except HTTPException as exc:
        if exc.status_code in (402, 403, 422):
            cap = C.require_capture(ctx, args["capture_id"])
            ctx.commit()
        else:
            raise
    return {"capture": CapturePublic.model_validate(cap).model_dump(mode="json")}


ACTIONS: tuple[Action, ...] = (
    Action(name="capture.confirm", handler=_confirm, args=CardArgs),
    Action(name="capture.confirm_all", handler=_confirm_all, args=CaptureArgs),
    Action(name="capture.discard", handler=_discard, args=CardArgs),
    Action(name="capture.undo", handler=_undo, args=CardArgs),
    Action(name="capture.redo", handler=_redo, args=CardArgs),
    Action(name="capture.answer", handler=_answer, args=AnswerArgs),
    Action(name="capture.edit", handler=_edit, args=EditArgs),
    Action(name="capture.skip", handler=_skip, args=CardArgs),
    Action(name="capture.retry", handler=_retry, args=CaptureArgs),
)


def register(r: Registry) -> None:
    r.entity(
        Entity(
            name="capture",
            model=Capture,
            payload=CaptureSync,
            public=CapturePublic,
            upsert=upsert_capture,
            delete=delete_capture,
            create_required=("client_uuid", "source"),
        )
    )
    r.entity(
        Entity(
            name="journal_entry",
            model=JournalEntry,
            payload=JournalSync,
            public=JournalPublic,
            upsert=upsert_journal,
            delete=delete_journal,
            create_required=("body",),
        )
    )
    r.entity(
        Entity(
            name="ai_settings",
            model=AISettings,
            payload=AISettingsUpdate,
            public=AISettingsPublic,
            upsert=upsert_settings,
            delete=reset_settings,
        )
    )
    for name, model, public in (
        ("record_card", RecordCard, CardSyncPublic),
        ("card_write_log", CardWriteLog, WriteLogSyncPublic),
        ("reply_item", ReplyItem, ReplyPublic),
        ("capture_attachment", CaptureAttachment, AttachmentPublic),
    ):
        r.entity(
            Entity(
                name=name,
                model=model,
                payload=BaseModel,
                public=public,
                read_only=True,
            )
        )
    for a in ACTIONS:
        r.action(a)
