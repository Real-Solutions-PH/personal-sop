"""The local-first sync engine (ADR-0011).

Push: ops apply in the order sent, each inside its own SAVEPOINT, through the
owning module's use cases. ``(owner, op_id)`` receipts make a replay return the
first result verbatim. Policy:

- upsert of a live row: field-level last-writer-wins in server order (only the
  fields the op carries are written).
- upsert of a row tombstoned on the server: ``conflict`` (a delete is not
  silently undone) unless the op is an explicit restore
  (``data == {"deleted_at": None}``).
- delete of an already-deleted or unknown row: ``applied`` (idempotent).
- a domain rule refusing the op: ``rejected`` with the rule's error code.
- an op carrying ``at`` (when the person made the change) is applied as of
  that instant: ``ctx.now`` (and so ``ctx.today``) is the device's time, so a
  set ticked offline keeps the time it was ticked and a rest timer started
  on a slow link ends when the phone shows it ending. ``at`` is clamped to
  ``[server now - MAX_OP_AGE, server now + MAX_CLOCK_AHEAD]``.

Pull: every registered entity's rows past ``cursor`` (tombstones included),
merged by ``version``, at most ``limit`` with ``truncated`` set when more wait.
"""

from datetime import UTC, datetime, timedelta
from typing import Any

from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlmodel import col, select

from app.modules.sync.models import SyncOpReceipt
from app.modules.sync.registry import Entity, registry
from app.modules.sync.schema import (
    SyncChange,
    SyncOp,
    SyncOpResult,
    SyncPull,
    SyncPushResult,
)
from app.shared import owned_repo
from app.shared.context import Ctx
from app.shared.owned import OwnedRow

# An outbox can wait out a long trip offline; older than this, the device's
# clock is the likelier fault and the server's time is used.
MAX_OP_AGE = timedelta(days=30)
# A phone clock running ahead: honoured up to this much, so the device's own
# rest countdown and elapsed time match what comes back on the next pull.
MAX_CLOCK_AHEAD = timedelta(minutes=5)


def op_time(at: datetime | None, server_now: datetime) -> datetime:
    """The instant an op is applied as of: the device's ``at`` when it is
    plausible, else the server's time."""
    if at is None:
        return server_now
    if at.tzinfo is None:
        at = at.replace(tzinfo=UTC)
    if at > server_now + MAX_CLOCK_AHEAD or at < server_now - MAX_OP_AGE:
        return server_now
    return at


def serialize(entity: Entity, row: OwnedRow) -> dict[str, Any]:
    return entity.public.model_validate(row).model_dump(mode="json")


def _apply(ctx: Ctx, op: SyncOp) -> SyncOpResult:
    reg = registry()
    if op.kind == "action":
        action = reg.actions.get(op.name)
        if action is None:
            return SyncOpResult(
                op_id=op.op_id, status="rejected", code="unknown_action"
            )
        args = action.args.model_validate(op.data)
        result = action.handler(ctx, args.model_dump())
        return SyncOpResult(op_id=op.op_id, status="applied", result=result)

    entity = reg.entities.get(op.name)
    if entity is None or entity.read_only:
        return SyncOpResult(op_id=op.op_id, status="rejected", code="unknown_entity")
    if op.id is None:
        return SyncOpResult(op_id=op.op_id, status="rejected", code="missing_id")

    existing = owned_repo.get(ctx, entity.model, op.id, include_deleted=True)
    if op.kind == "delete":
        if existing is not None and existing.deleted_at is None:
            if entity.delete is not None:
                entity.delete(ctx, op.id)
            else:
                owned_repo.soft_delete(ctx, existing)
        return SyncOpResult(op_id=op.op_id, status="applied")

    is_restore = op.data == {"deleted_at": None}
    if existing is not None and existing.deleted_at is not None and not is_restore:
        return SyncOpResult(
            op_id=op.op_id,
            status="conflict",
            code="deleted_on_server",
            row=serialize(entity, existing),
        )
    if is_restore:
        if existing is None:
            return SyncOpResult(op_id=op.op_id, status="rejected", code="not_found")
        if entity.restore is not None:
            existing = entity.restore(ctx, op.id)
        else:
            owned_repo.restore(ctx, existing)
        ctx.session.flush()
        ctx.session.refresh(existing)
        return SyncOpResult(
            op_id=op.op_id, status="applied", row=serialize(entity, existing)
        )

    payload = entity.payload.model_validate(op.data)
    if existing is None:
        missing = [
            f for f in entity.create_required if f not in payload.model_fields_set
        ]
        if missing:
            return SyncOpResult(
                op_id=op.op_id,
                status="rejected",
                code="missing_fields",
                message="Missing fields: " + ", ".join(missing),
            )
    if entity.upsert is not None:
        row = entity.upsert(ctx, op.id, payload)
    else:
        row, _ = owned_repo.upsert(
            ctx, entity.model, op.id, payload.model_dump(exclude_unset=True)
        )
    ctx.session.flush()
    ctx.session.refresh(row)
    return SyncOpResult(op_id=op.op_id, status="applied", row=serialize(entity, row))


def push(ctx: Ctx, ops: list[SyncOp]) -> SyncPushResult:
    ctx.in_batch = True
    server_now = ctx.now
    results: list[SyncOpResult] = []
    for op in ops:
        ctx.now = op_time(op.at, server_now)
        receipt = ctx.session.get(SyncOpReceipt, (ctx.user_id, op.op_id))
        if receipt is not None:
            stored = SyncOpResult.model_validate(receipt.result)
            results.append(stored.model_copy(update={"replayed": True}))
            continue
        savepoint = ctx.session.begin_nested()
        try:
            result = _apply(ctx, op)
            if result.status != "applied":
                savepoint.rollback()
            else:
                savepoint.commit()
        except HTTPException as exc:
            savepoint.rollback()
            detail: dict[str, object] = (
                exc.detail if isinstance(exc.detail, dict) else {}
            )
            result = SyncOpResult(
                op_id=op.op_id,
                status="rejected",
                code=str(detail.get("code") or f"http_{exc.status_code}"),
                message=str(detail.get("message") or "Rejected"),
            )
        except ValidationError as exc:
            savepoint.rollback()
            # Field locations only: pydantic's message embeds the input.
            result = SyncOpResult(
                op_id=op.op_id,
                status="rejected",
                code="validation_error",
                message="Invalid fields: "
                + ", ".join(".".join(str(p) for p in e["loc"]) for e in exc.errors()),
            )
        except IntegrityError:
            savepoint.rollback()
            result = SyncOpResult(
                op_id=op.op_id, status="rejected", code="integrity_conflict"
            )
        ctx.session.add(
            SyncOpReceipt(
                owner_id=ctx.user_id,
                tenant_id=ctx.tenant_id,
                op_id=op.op_id,
                entity=op.name,
                status=result.status,
                result=result.model_dump(mode="json"),
            )
        )
        ctx.session.commit()
        results.append(result)
    ctx.now = server_now
    ctx.in_batch = False
    return SyncPushResult(results=results, cursor=max_version(ctx))


def max_version(ctx: Ctx) -> int:
    """The highest version this user can currently see (the pull cursor a
    device that just pushed may jump to after pulling)."""
    best = 0
    for entity in registry().entities.values():
        v = ctx.session.exec(
            select(func.max(entity.model.version)).where(
                *owned_repo.scope(ctx, entity.model)
            )
        ).one()
        if v is not None and int(v) > best:
            best = int(v)
    return best


def pull(ctx: Ctx, cursor: int, limit: int) -> SyncPull:
    batch: list[tuple[int, Entity, OwnedRow]] = []
    for entity in registry().entities.values():
        model = entity.model
        rows = ctx.session.exec(
            select(model)
            .where(*owned_repo.scope(ctx, model), col(model.version) > cursor)
            .order_by(col(model.version))
            .limit(limit + 1)
        ).all()
        batch.extend((r.version, entity, r) for r in rows)
    batch.sort(key=lambda item: item[0])
    truncated = len(batch) > limit
    page = batch[:limit]
    changes = [
        SyncChange(
            entity=entity.name,
            id=row.id,
            version=version,
            deleted=row.deleted_at is not None,
            row=None if row.deleted_at is not None else serialize(entity, row),
        )
        for version, entity, row in page
    ]
    next_cursor = page[-1][0] if page else cursor
    return SyncPull(changes=changes, cursor=next_cursor, truncated=truncated)


def entity_names() -> list[str]:
    return sorted(registry().entities)
