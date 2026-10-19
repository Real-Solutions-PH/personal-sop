"""Journal routes (CAP-15 list, CAP-16 editor). The journal belongs to the
capture module, so it shares the ``capture:*`` permissions."""

import uuid
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Query

from app.modules.capture import journal
from app.modules.capture.schema import (
    JournalIn,
    JournalPublic,
    JournalsPublic,
    JournalUpdate,
)
from app.modules.iam.deps import require_permission
from app.shared.context import CtxDep
from app.shared.pagination import PaginationDep
from app.shared.rate_limit import rate_limited

router = APIRouter(prefix="/journal", tags=["journal"])

READ = [Depends(require_permission("capture:read"))]
WRITE = [rate_limited("capture"), Depends(require_permission("capture:write"))]


@router.get("/", response_model=JournalsPublic, dependencies=READ)
def list_entries(
    ctx: CtxDep,
    page: PaginationDep,
    q: Annotated[str | None, Query(max_length=100)] = None,
    area: Annotated[str | None, Query(max_length=40)] = None,
    tag: Annotated[str | None, Query(max_length=40)] = None,
    mood: Annotated[int | None, Query(ge=1, le=5)] = None,
) -> Any:
    """CAP-15: newest first, search body and tags, filter by area/tag/mood,
    with the journaling streak."""
    rows, count = journal.find(
        ctx, q=q, area=area, tag=tag, mood=mood, skip=page.skip, limit=page.limit
    )
    return JournalsPublic(
        data=[JournalPublic.model_validate(r) for r in rows],
        count=count,
        streak=journal.streak(ctx),
    )


@router.post("/", response_model=JournalPublic, status_code=201, dependencies=WRITE)
def create_entry(ctx: CtxDep, data: JournalIn) -> Any:
    """CAP-16 New entry (private by default)."""
    return journal.create(ctx, data=data)


@router.get("/{entry_id}", response_model=JournalPublic, dependencies=READ)
def get_entry(ctx: CtxDep, entry_id: uuid.UUID) -> Any:
    return journal.get(ctx, entry_id=entry_id)


@router.patch("/{entry_id}", response_model=JournalPublic, dependencies=WRITE)
def update_entry(ctx: CtxDep, entry_id: uuid.UUID, data: JournalUpdate) -> Any:
    return journal.update(ctx, entry_id=entry_id, data=data)


@router.delete("/{entry_id}", status_code=204, dependencies=WRITE)
def delete_entry(ctx: CtxDep, entry_id: uuid.UUID) -> None:
    journal.delete(ctx, entry_id=entry_id)


@router.post("/{entry_id}/restore", response_model=JournalPublic, dependencies=WRITE)
def restore_entry(ctx: CtxDep, entry_id: uuid.UUID) -> Any:
    """The undo toast after a delete."""
    return journal.restore(ctx, entry_id=entry_id)
