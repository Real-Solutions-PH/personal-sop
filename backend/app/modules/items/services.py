import uuid

from fastapi import HTTPException
from sqlmodel import Session

from app.modules.iam.users.models import User
from app.modules.items import repo as item_repo
from app.modules.items.models import Item
from app.modules.items.schema import ItemCreate, ItemUpdate


def _tenant_filter(current_user: User) -> uuid.UUID | None:
    """Superusers are platform operators: no tenant filter. Everyone else only
    sees rows in their own tenant — cross-tenant rows 404 (no existence leak);
    same-tenant, wrong-owner rows keep their 403."""
    return None if current_user.is_superuser else current_user.tenant_id


def _get_visible_item(
    *, session: Session, current_user: User, item_id: uuid.UUID
) -> Item:
    item = item_repo.get_by_id(
        session=session, item_id=item_id, tenant_id=_tenant_filter(current_user)
    )
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    if not current_user.is_superuser and item.owner_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not enough permissions")
    return item


def list_items(
    *, session: Session, current_user: User, skip: int = 0, limit: int = 100
) -> tuple[list[Item], int]:
    owner_id = None if current_user.is_superuser else current_user.id
    return item_repo.get_multi(
        session=session,
        tenant_id=_tenant_filter(current_user),
        owner_id=owner_id,
        skip=skip,
        limit=limit,
    )


def get_item(*, session: Session, current_user: User, item_id: uuid.UUID) -> Item:
    return _get_visible_item(
        session=session, current_user=current_user, item_id=item_id
    )


def create_item(*, session: Session, current_user: User, item_in: ItemCreate) -> Item:
    db_item = Item.model_validate(
        item_in,
        update={"owner_id": current_user.id, "tenant_id": current_user.tenant_id},
    )
    return item_repo.create(session=session, item=db_item)


def update_item(
    *,
    session: Session,
    current_user: User,
    item_id: uuid.UUID,
    item_in: ItemUpdate,
) -> Item:
    item = _get_visible_item(
        session=session, current_user=current_user, item_id=item_id
    )
    update_data = item_in.model_dump(exclude_unset=True)
    return item_repo.update(session=session, item=item, update_data=update_data)


def delete_item(*, session: Session, current_user: User, item_id: uuid.UUID) -> None:
    item = _get_visible_item(
        session=session, current_user=current_user, item_id=item_id
    )
    item_repo.delete(session=session, item=item)
