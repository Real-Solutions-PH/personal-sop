"""Sync registrations for the companion module.

Messages are pulled, never pushed: a message only exists as one side of an
``ask``, which answers it. The companion row, trackers (one per metric) and
memories are field writes.
"""

import uuid

from pydantic import BaseModel

from app.modules.companion import memory, services
from app.modules.companion.defaults import COMPANION_NAME
from app.modules.companion.models import Companion, CompanionMessage, Memory, Tracker
from app.modules.companion.schema import (
    CompanionPublic,
    CompanionSync,
    MemoryPublic,
    MemorySync,
    MessagePublic,
    TrackerPublic,
    TrackerSync,
)
from app.modules.sync.registry import Entity, Registry
from app.shared import owned_repo
from app.shared.context import Ctx
from app.shared.owned import OwnedRow


def upsert_companion(ctx: Ctx, row_id: uuid.UUID, payload: BaseModel) -> OwnedRow:
    del row_id  # one row per user
    data = payload.model_dump(exclude_unset=True)
    row = services.companion_row(ctx)
    if "name" in data:
        row.name = (data["name"] or "").strip() or COMPANION_NAME
        ctx.session.add(row)
    ctx.commit()
    return row


def upsert_tracker(ctx: Ctx, row_id: uuid.UUID, payload: BaseModel) -> OwnedRow:
    data = payload.model_dump(exclude_unset=True)
    existing = owned_repo.get(ctx, Tracker, row_id, include_deleted=True)
    metric = data.get("metric") or (existing.metric if existing else None)
    row = services.upsert_tracker_row(ctx, str(metric), {**data, "id": row_id})
    ctx.commit()
    return row


def delete_tracker(ctx: Ctx, row_id: uuid.UUID) -> None:
    services.remove_tracker(ctx, tracker_id=row_id)


def upsert_memory(ctx: Ctx, row_id: uuid.UUID, payload: BaseModel) -> OwnedRow:
    """A memory typed in the app: a new one goes through the memory layer
    (an exact or near repeat is not added twice); an edited one keeps its id
    with its hash refreshed and its embedding redone."""
    data = payload.model_dump(exclude_unset=True)
    body = memory.normalise(str(data["text"]))[:500]
    existing = owned_repo.get(ctx, Memory, row_id, include_deleted=True)
    if existing is None:
        saved = memory.remember(ctx, text=body, memory_id=row_id, source="app")
        row = saved.memory
        if row.id != row_id:
            # Already known: the device's copy becomes a tombstone pointing
            # at the memory that stays, so the next pull drops it there.
            row, _ = owned_repo.upsert(
                ctx,
                Memory,
                row_id,
                {"text": body, "source": "app", "superseded_by": saved.memory.id},
            )
            owned_repo.soft_delete(ctx, row)
    else:
        row, _ = owned_repo.upsert(
            ctx,
            Memory,
            row_id,
            {
                "text": body,
                "text_hash": memory.text_hash(body),
                "embedding": None,
                "embed_model": None,
            },
        )
        memory.backfill(ctx, limit=1)
    ctx.commit()
    return row


def register(r: Registry) -> None:
    r.entity(
        Entity(
            name="companion",
            model=Companion,
            payload=CompanionSync,
            public=CompanionPublic,
            upsert=upsert_companion,
        )
    )
    r.entity(
        Entity(
            name="companion_message",
            model=CompanionMessage,
            payload=BaseModel,
            public=MessagePublic,
            read_only=True,
        )
    )
    r.entity(
        Entity(
            name="tracker",
            model=Tracker,
            payload=TrackerSync,
            public=TrackerPublic,
            upsert=upsert_tracker,
            delete=delete_tracker,
            create_required=("metric",),
        )
    )
    r.entity(
        Entity(
            name="memory",
            model=Memory,
            payload=MemorySync,
            public=MemoryPublic,
            upsert=upsert_memory,
            create_required=("text",),
        )
    )
