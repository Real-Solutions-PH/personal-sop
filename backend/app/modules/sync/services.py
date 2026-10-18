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

Pull: every registered entity's rows past ``cursor`` (tombstones included),
merged by ``version``, at most ``limit`` with ``truncated`` set when more wait.
"""

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
    results: list[SyncOpResult] = []
    for op in ops:
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
    ctx.in_batch = False
    return SyncPushResult(results=results, cursor=max_version(ctx))


def max_version(ctx: Ctx) -> int:
    """The highest version this user can currently see (the pull cursor a
    device that just pushed may jump to after pulling)."""
    best = 0
    for entity in registry().entities.values():
        v = ctx.session.exec(
            select(func.max(entity.model.version)).where(
                entity.model.owner_id == ctx.user_id
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
            .where(
                model.owner_id == ctx.user_id,
                model.tenant_id == ctx.tenant_id,
                col(model.version) > cursor,
            )
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
