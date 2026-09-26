import uuid
from typing import Any

from fastapi import APIRouter, Depends

from app.modules.iam.deps import CurrentUser, require_permission
from app.modules.iam.permissions.schema import PermissionPublic
from app.modules.iam.rbac import repo as rbac_repo
from app.modules.iam.rbac import services as rbac_service
from app.modules.iam.rbac.schema import RolePermissionsPublic, UserPermissions
from app.shared.deps import SessionDep
from app.shared.schema import Message

# Privilege-granting surface (assign roles, grant permissions): gated on
# rbac:manage, held by the superadmin role's "*" grant. The superuser flag
# still bypasses; ordinary and tenant-admin accounts are refused.
router = APIRouter(
    prefix="/rbac",
    tags=["rbac"],
    dependencies=[Depends(require_permission("rbac:manage"))],
)


@router.get("/users/{user_id}/permissions", response_model=UserPermissions)
def read_user_permissions(session: SessionDep, user_id: uuid.UUID) -> Any:
    return rbac_service.get_user_permissions(session=session, user_id=user_id)


@router.post("/users/{user_id}/roles/{role_id}", response_model=Message)
def assign_role(
    session: SessionDep,
    user_id: uuid.UUID,
    role_id: uuid.UUID,
    current_user: CurrentUser,
) -> Any:
    rbac_service.assign_role_to_user(
        session=session, user_id=user_id, role_id=role_id, actor_id=current_user.id
    )
    return Message(message="Role assigned")


@router.delete("/users/{user_id}/roles/{role_id}", response_model=Message)
def remove_role(
    session: SessionDep,
    user_id: uuid.UUID,
    role_id: uuid.UUID,
    current_user: CurrentUser,
) -> Any:
    rbac_service.remove_role_from_user(
        session=session, user_id=user_id, role_id=role_id, actor_id=current_user.id
    )
    return Message(message="Role removed")


@router.get("/roles/{role_id}/permissions", response_model=RolePermissionsPublic)
def read_role_permissions(session: SessionDep, role_id: uuid.UUID) -> Any:
    perms = rbac_repo.get_role_permissions(session=session, role_id=role_id)
    return RolePermissionsPublic(
        data=[PermissionPublic.model_validate(p) for p in perms], count=len(perms)
    )


@router.post("/roles/{role_id}/permissions/{permission_id}", response_model=Message)
def add_permission(
    session: SessionDep,
    role_id: uuid.UUID,
    permission_id: uuid.UUID,
    current_user: CurrentUser,
) -> Any:
    rbac_service.add_permission_to_role(
        session=session,
        role_id=role_id,
        permission_id=permission_id,
        actor_id=current_user.id,
    )
    return Message(message="Permission granted")


@router.delete("/roles/{role_id}/permissions/{permission_id}", response_model=Message)
def remove_permission(
    session: SessionDep,
    role_id: uuid.UUID,
    permission_id: uuid.UUID,
    current_user: CurrentUser,
) -> Any:
    rbac_service.remove_permission_from_role(
        session=session,
        role_id=role_id,
        permission_id=permission_id,
        actor_id=current_user.id,
    )
    return Message(message="Permission revoked")
