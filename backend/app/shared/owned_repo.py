"""Generic data access for :class:`~app.shared.owned.OwnedRow` tables.

Ownership is a service invariant: every lookup filters on ``owner_id`` (and
``tenant_id``), so another user's id is a natural 404 with no existence leak.
Row-level security is the second wall underneath.

Upserts are idempotent on the client-minted id, and a write that hits a
natural-key unique constraint whose holder is a tombstone REVIVES that row
instead of failing (e.g. re-logging a habit on a day whose log was undone).
"""

import uuid
from collections.abc import Iterable, Sequence
from typing import Any, TypeVar

from sqlalchemy import ColumnElement
from sqlmodel import col, func, select

from app.shared.context import Ctx
from app.shared.domain import not_found
from app.shared.owned import OwnedRow

M = TypeVar("M", bound=OwnedRow)

# Fields a client may never write through a generic upsert.
PROTECTED = frozenset(
    {"id", "owner_id", "tenant_id", "created_at", "updated_at", "version", "deleted_at"}
)


def get(
    ctx: Ctx, model: type[M], row_id: uuid.UUID, *, include_deleted: bool = False
) -> M | None:
    q = select(model).where(
        model.id == row_id,
        model.owner_id == ctx.user_id,
        model.tenant_id == ctx.tenant_id,
    )
    if not include_deleted:
        q = q.where(col(model.deleted_at).is_(None))
    return ctx.session.exec(q).first()


def require(
    ctx: Ctx,
    model: type[M],
    row_id: uuid.UUID,
    *,
    what: str,
    include_deleted: bool = False,
) -> M:
    row = get(ctx, model, row_id, include_deleted=include_deleted)
    if row is None:
        raise not_found(what)
    return row


def list_rows(
    ctx: Ctx,
    model: type[M],
    *where: ColumnElement[bool],
    order_by: Sequence[Any] = (),
    skip: int = 0,
    limit: int | None = None,
    include_deleted: bool = False,
) -> list[M]:
    q = select(model).where(
        model.owner_id == ctx.user_id, model.tenant_id == ctx.tenant_id, *where
    )
    if not include_deleted:
        q = q.where(col(model.deleted_at).is_(None))
    if order_by:
        q = q.order_by(*order_by)
    q = q.offset(skip)
    if limit is not None:
        q = q.limit(limit)
    return list(ctx.session.exec(q).all())


def count_rows(ctx: Ctx, model: type[M], *where: ColumnElement[bool]) -> int:
    q = (
        select(func.count())
        .select_from(model)
        .where(
            model.owner_id == ctx.user_id,
            model.tenant_id == ctx.tenant_id,
            col(model.deleted_at).is_(None),
            *where,
        )
    )
    return int(ctx.session.exec(q).one())


def find_one(
    ctx: Ctx, model: type[M], *where: ColumnElement[bool], include_deleted: bool = False
) -> M | None:
    rows = list_rows(ctx, model, *where, limit=1, include_deleted=include_deleted)
    return rows[0] if rows else None


def insert(
    ctx: Ctx, model: type[M], data: dict[str, Any], *, row_id: uuid.UUID | None = None
) -> M:
    values = {k: v for k, v in data.items() if k not in PROTECTED}
    row = model(**values, **ctx.owned(), **({"id": row_id} if row_id else {}))
    ctx.session.add(row)
    ctx.session.flush()
    return row


def apply(row: M, data: dict[str, Any]) -> M:
    """Write the given (already validated) fields onto a row."""
    for key, value in data.items():
        if key in PROTECTED:
            continue
        if not hasattr(row, key):
            # SQLModel silently drops unknown attributes; fail loudly instead.
            raise AttributeError(f"{type(row).__name__} has no field {key}")
        setattr(row, key, value)
    return row


def upsert(
    ctx: Ctx,
    model: type[M],
    row_id: uuid.UUID,
    data: dict[str, Any],
    *,
    natural_key: Iterable[str] = (),
) -> tuple[M, bool]:
    """Create-or-update by client id. Returns ``(row, created)``.

    A tombstoned row with the same id is revived (undo of a delete replayed
    from another device). With ``natural_key`` a live-or-dead row holding the
    same natural key is reused, so the unique constraint never trips.
    """
    row = get(ctx, model, row_id, include_deleted=True)
    if row is None and natural_key:
        conds = [getattr(model, k) == data[k] for k in natural_key]
        row = find_one(ctx, model, *conds, include_deleted=True)
    if row is None:
        # An id already used by someone else is invisible here; inserting it
        # raises an IntegrityError the route turns into a conflict.
        return insert(ctx, model, data, row_id=row_id), True
    apply(row, data)
    row.deleted_at = None
    ctx.session.add(row)
    ctx.session.flush()
    return row, False


def soft_delete(ctx: Ctx, row: OwnedRow) -> None:
    row.deleted_at = ctx.now
    ctx.session.add(row)
    ctx.session.flush()


def restore(ctx: Ctx, row: OwnedRow) -> None:
    row.deleted_at = None
    ctx.session.add(row)
    ctx.session.flush()


def refresh(ctx: Ctx, row: M) -> M:
    """Reload server-assigned columns (``version`` from the trigger)."""
    ctx.session.refresh(row)
    return row
