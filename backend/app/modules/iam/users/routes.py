import uuid
from typing import Any

from fastapi import APIRouter, Depends

from app.modules.iam.deps import CurrentUser, require_permission
from app.modules.iam.users import services as user_service
from app.modules.iam.users.schema import (
    UserCreate,
    UserPublic,
    UsersPublic,
    UserUpdate,
    UserUpdateMe,
)
from app.shared.deps import SessionDep
from app.shared.pagination import PaginationDep
from app.shared.schema import Message

router = APIRouter(prefix="/users", tags=["users"])


@router.get(
    "/",
    dependencies=[Depends(require_permission("users:read"))],
    response_model=UsersPublic,
)
def read_users(session: SessionDep, pagination: PaginationDep) -> Any:
    users, count = user_service.list_users(
        session=session, skip=pagination.skip, limit=pagination.limit
    )
    users_public = [UserPublic.model_validate(user) for user in users]
    return UsersPublic(data=users_public, count=count)


@router.post(
    "/",
    dependencies=[Depends(require_permission("users:write"))],
    response_model=UserPublic,
)
def create_user(
    *, session: SessionDep, user_in: UserCreate, current_user: CurrentUser
) -> Any:
    return user_service.create_user(
        session=session, user_in=user_in, actor_id=current_user.id
    )


@router.patch("/me", response_model=UserPublic)
def update_user_me(
    *, session: SessionDep, user_in: UserUpdateMe, current_user: CurrentUser
) -> Any:
    return user_service.update_user_me(
        session=session, current_user=current_user, user_in=user_in
    )


@router.get("/me", response_model=UserPublic)
def read_user_me(current_user: CurrentUser) -> Any:
    return current_user


@router.get("/me/export")
def export_my_data(session: SessionDep, current_user: CurrentUser) -> dict[str, Any]:
    """Self-service data export (GDPR portability): the caller's own record and
    all their items. Gated by authentication only — it is your own data."""
    return user_service.export_user_data(session=session, user_id=current_user.id)


@router.delete("/me", response_model=Message)
def delete_user_me(session: SessionDep, current_user: CurrentUser) -> Any:
    user_service.delete_user_me(session=session, current_user=current_user)
    return Message(message="User deleted successfully")


@router.get("/{user_id}", response_model=UserPublic)
def read_user_by_id(
    user_id: uuid.UUID, session: SessionDep, current_user: CurrentUser
) -> Any:
    return user_service.read_user_by_id(
        session=session, user_id=user_id, current_user=current_user
    )


@router.patch(
    "/{user_id}",
    dependencies=[Depends(require_permission("users:write"))],
    response_model=UserPublic,
)
def update_user(
    *,
    session: SessionDep,
    user_id: uuid.UUID,
    user_in: UserUpdate,
    current_user: CurrentUser,
) -> Any:
    return user_service.update_user(
        session=session, user_id=user_id, user_in=user_in, actor_id=current_user.id
    )


@router.get(
    "/{user_id}/export",
    dependencies=[Depends(require_permission("data:export"))],
)
def export_user_data(user_id: uuid.UUID, session: SessionDep) -> dict[str, Any]:
    """Export a user's data (GDPR portability), for a data:export holder (e.g.
    the DPO). Returns the profile row and all items; carries no credentials."""
    return user_service.export_user_data(session=session, user_id=user_id)


@router.delete("/{user_id}", dependencies=[Depends(require_permission("users:delete"))])
def delete_user(
    session: SessionDep, current_user: CurrentUser, user_id: uuid.UUID
) -> Message:
    user_service.delete_user(
        session=session, current_user=current_user, user_id=user_id
    )
    return Message(message="User deleted successfully")


@router.delete(
    "/{user_id}/erase",
    dependencies=[Depends(require_permission("data:erase"))],
    response_model=Message,
)
def erase_user_data(
    session: SessionDep, current_user: CurrentUser, user_id: uuid.UUID
) -> Message:
    """Erase a user (GDPR right to erasure), for a data:erase holder. Runs the
    same irreversible hard delete as the admin path: revokes the auth identity,
    then cascades the local rows. Audited as ``user.delete``."""
    user_service.delete_user(
        session=session, current_user=current_user, user_id=user_id
    )
    return Message(message="User data erased")
