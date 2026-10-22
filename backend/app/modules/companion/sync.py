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
    """A memory typed or edited in the app. A new one goes through the memory
    layer (an exact or near repeat is not added twice). An edit keeps its id
    and changes only the fields sent; new text refreshes its hash and redoes
    its embedding."""
    data = payload.model_dump(exclude_unset=True)
    body = memory.normalise(str(data["text"]))[:500] if "text" in data else None
    tags = memory.clean_tags(data["tags"]) if "tags" in data else None
    existing = owned_repo.get(ctx, Memory, row_id, include_deleted=True)
    if existing is None:
        if body is None:  # create_required guards this; a defensive stop
            raise ValueError("a new memory needs text")
        saved = memory.remember(
            ctx,
            text=body,
            kind=data.get("kind") or "fact",
            tags=tags,
            importance=data.get("importance") or 3,
            always_on=bool(data.get("always_on")),
            memory_id=row_id,
            source="app",
        )
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
        fields: dict[str, object] = {
            k: data[k] for k in ("kind", "importance", "always_on") if k in data
        }
        if tags is not None:
            fields["tags"] = tags
        reembed = body is not None and body != existing.text
        if reembed:
            fields |= {
                "text": body,
                "text_hash": memory.text_hash(str(body)),
                "embedding": None,
                "embed_model": None,
            }
        row, _ = owned_repo.upsert(ctx, Memory, row_id, fields)
        if reembed:
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
