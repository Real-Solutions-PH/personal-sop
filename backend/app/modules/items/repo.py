import uuid
from datetime import datetime, timezone
from typing import Any

from sqlmodel import Session, col, func, select

from app.modules.items.models import Item


def get_by_id(
    *, session: Session, item_id: uuid.UUID, tenant_id: uuid.UUID | None
) -> Item | None:
    """Tenant filter lives in the WHERE clause: rows outside ``tenant_id``
    are invisible (natural 404). ``tenant_id=None`` = superuser bypass.

    Soft-deleted rows (``deleted_at`` set) are invisible everywhere — the
    soft-delete convention (see docs/data-protection.md)."""
    query = select(Item).where(Item.id == item_id, col(Item.deleted_at).is_(None))
    if tenant_id is not None:
        query = query.where(Item.tenant_id == tenant_id)
    return session.exec(query).first()


def get_multi(
    *,
    session: Session,
    tenant_id: uuid.UUID | None,
    owner_id: uuid.UUID | None = None,
    skip: int = 0,
    limit: int = 100,
) -> tuple[list[Item], int]:
    count_query = (
        select(func.count()).select_from(Item).where(col(Item.deleted_at).is_(None))
    )
    items_query = (
        select(Item)
        .where(col(Item.deleted_at).is_(None))
        .order_by(col(Item.created_at).desc())
        .offset(skip)
        .limit(limit)
    )
    if tenant_id is not None:
        count_query = count_query.where(Item.tenant_id == tenant_id)
        items_query = items_query.where(Item.tenant_id == tenant_id)
    if owner_id is not None:
        count_query = count_query.where(Item.owner_id == owner_id)
        items_query = items_query.where(Item.owner_id == owner_id)
    count = session.exec(count_query).one()
    items = session.exec(items_query).all()
    return list(items), count


def list_all_by_owner(*, session: Session, owner_id: uuid.UUID) -> list[Item]:
    """Every item owned by ``owner_id``, INCLUDING soft-deleted ones.

    For the GDPR data-export flow: a data-portability export must return all
    personal data still held, retained soft-deleted rows included."""
    return list(
        session.exec(
            select(Item)
            .where(Item.owner_id == owner_id)
            .order_by(col(Item.created_at).desc())
        ).all()
    )


def soft_delete(*, session: Session, item: Item) -> Item:
    """Mark an item logically deleted (reversible) rather than erasing it.

    After this it disappears from ``get_by_id``/``get_multi`` but the row and
    its data are retained until an explicit hard :func:`delete` (erasure)."""
    item.deleted_at = datetime.now(timezone.utc)
    session.add(item)
    session.commit()
    session.refresh(item)
    return item


def create(*, session: Session, item: Item) -> Item:
    session.add(item)
    session.commit()
    session.refresh(item)
    return item


def update(*, session: Session, item: Item, update_data: dict[str, Any]) -> Item:
    item.sqlmodel_update(update_data)
    session.add(item)
    session.commit()
    session.refresh(item)
    return item


def delete(*, session: Session, item: Item) -> None:
    session.delete(item)
    session.commit()
