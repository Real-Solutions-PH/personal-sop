import uuid
from typing import Any

from fastapi import APIRouter, Depends

from app.modules.iam.deps import CurrentUser, require_permission
from app.modules.items import services as item_service
from app.modules.items.schema import ItemCreate, ItemPublic, ItemsPublic, ItemUpdate
from app.shared.pagination import PaginationDep
from app.shared.rate_limit import rate_limited
from app.shared.schema import Message
from app.shared.tenant_session import TenantScopedSessionDep

# Owner-scoped resource: the service enforces per-user/tenant ownership; the
# permission gate is the coarse, revocable feature-access layer on top. Every
# provisioned user holds items:* via the baseline "user" role.
router = APIRouter(prefix="/items", tags=["items"])


@router.get(
    "/",
    response_model=ItemsPublic,
    dependencies=[Depends(require_permission("items:read"))],
)
def read_items(
    session: TenantScopedSessionDep,
    current_user: CurrentUser,
    pagination: PaginationDep,
) -> Any:
    items, count = item_service.list_items(
        session=session,
        current_user=current_user,
        skip=pagination.skip,
        limit=pagination.limit,
    )
    items_public = [ItemPublic.model_validate(item) for item in items]
    return ItemsPublic(data=items_public, count=count)


@router.get(
    "/{id}",
    response_model=ItemPublic,
    dependencies=[Depends(require_permission("items:read"))],
)
def read_item(
    session: TenantScopedSessionDep, current_user: CurrentUser, id: uuid.UUID
) -> Any:
    return item_service.get_item(session=session, current_user=current_user, item_id=id)


@router.post(
    "/",
    response_model=ItemPublic,
    dependencies=[rate_limited("items"), Depends(require_permission("items:write"))],
)
def create_item(
    *, session: TenantScopedSessionDep, current_user: CurrentUser, item_in: ItemCreate
) -> Any:
    return item_service.create_item(
        session=session, current_user=current_user, item_in=item_in
    )


@router.put(
    "/{id}",
    response_model=ItemPublic,
    dependencies=[rate_limited("items"), Depends(require_permission("items:write"))],
)
def update_item(
    *,
    session: TenantScopedSessionDep,
    current_user: CurrentUser,
    id: uuid.UUID,
    item_in: ItemUpdate,
) -> Any:
    return item_service.update_item(
        session=session, current_user=current_user, item_id=id, item_in=item_in
    )


@router.delete(
    "/{id}",
    dependencies=[rate_limited("items"), Depends(require_permission("items:delete"))],
)
def delete_item(
    session: TenantScopedSessionDep, current_user: CurrentUser, id: uuid.UUID
) -> Message:
    item_service.delete_item(session=session, current_user=current_user, item_id=id)
    return Message(message="Item deleted successfully")
