"""Generic data access for :class:`~app.shared.owned.OwnedRow` tables.

Ownership is a service invariant: every lookup filters on ``owner_id`` (and
``tenant_id``), so another user's id is a natural 404 with no existence leak.
Row-level security is the second wall underneath.

A ``shared_catalog`` table is read tenant-wide instead, and every write path
here (upsert, soft delete, restore, :func:`require_writable`) refuses a row
whose author is someone else unless the caller is an admin.

Upserts are idempotent on the client-minted id, and a write that hits a
natural-key unique constraint whose holder is a tombstone REVIVES that row
instead of failing (e.g. re-logging a habit on a day whose log was undone).
"""

import uuid
from collections.abc import Iterable, Sequence
from typing import Any, TypeVar

from sqlalchemy import ColumnElement
from sqlalchemy.exc import IntegrityError
from sqlmodel import col, func, select

from app.shared.context import Ctx
from app.shared.domain import domain_error, not_found
from app.shared.owned import OwnedRow

M = TypeVar("M", bound=OwnedRow)

# Fields a client may never write through a generic upsert.
PROTECTED = frozenset(
    {"id", "owner_id", "tenant_id", "created_at", "updated_at", "version", "deleted_at"}
)


def scope(ctx: Ctx, model: type[M]) -> list[ColumnElement[bool]]:
    """Who sees a row: its owner, or the whole tenant for a shared catalog."""
    tenant = model.tenant_id == ctx.tenant_id
    if model.shared_catalog:
        return [tenant]  # type: ignore[list-item]
    return [model.owner_id == ctx.user_id, tenant]  # type: ignore[list-item]


def can_write(ctx: Ctx, row: OwnedRow) -> bool:
    """Whether the caller may change this row: always their own; another
    member's shared catalog row only as an admin."""
    return row.owner_id == ctx.user_id or (
        type(row).shared_catalog and bool(ctx.user.is_superuser)
    )


def guard_write(ctx: Ctx, row: OwnedRow) -> None:
    if not can_write(ctx, row):
        raise domain_error(
            403,
            "catalog_read_only",
            "Another member added this; only they or an admin can change it",
        )


def get(
    ctx: Ctx, model: type[M], row_id: uuid.UUID, *, include_deleted: bool = False
) -> M | None:
    q = select(model).where(model.id == row_id, *scope(ctx, model))
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


def require_writable(
    ctx: Ctx,
    model: type[M],
    row_id: uuid.UUID,
    *,
    what: str,
    include_deleted: bool = False,
) -> M:
    """``require``, refusing (403) a shared row the caller may not change."""
    row = require(ctx, model, row_id, what=what, include_deleted=include_deleted)
    guard_write(ctx, row)
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
    q = select(model).where(*scope(ctx, model), *where)
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
        .where(*scope(ctx, model), col(model.deleted_at).is_(None), *where)
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


def insert_once(
    ctx: Ctx, model: type[M], data: dict[str, Any], *, row_id: uuid.UUID
) -> tuple[M, bool]:
    """Insert a row whose id is derived (one per user, created on first
    touch), tolerating a concurrent request that inserts the same id.

    The first requests after sign-in arrive together, and each one finding
    no row would insert the same primary key: the losers waited on the
    winner's transaction and then failed with a duplicate key. Inside a
    SAVEPOINT the loser instead reads the winner's row. Returns
    ``(row, created)``; seed dependent rows only when ``created``.
    """
    try:
        with ctx.session.begin_nested():
            row = insert(ctx, model, data, row_id=row_id)
        return row, True
    except IntegrityError:
        existing = ctx.session.get(model, row_id, populate_existing=True)
        if existing is None or existing.owner_id != ctx.user_id:
            raise
        return existing, False


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
    guard_write(ctx, row)
    apply(row, data)
    row.deleted_at = None
    ctx.session.add(row)
    ctx.session.flush()
    return row, False


def soft_delete(ctx: Ctx, row: OwnedRow) -> None:
    guard_write(ctx, row)
    row.deleted_at = ctx.now
    ctx.session.add(row)
    ctx.session.flush()


def restore(ctx: Ctx, row: OwnedRow) -> None:
    guard_write(ctx, row)
    row.deleted_at = None
    ctx.session.add(row)
    ctx.session.flush()


def refresh(ctx: Ctx, row: M) -> M:
    """Reload server-assigned columns (``version`` from the trigger)."""
    ctx.session.refresh(row)
    return row
