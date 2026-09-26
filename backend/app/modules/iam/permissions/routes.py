import uuid
from typing import Any

from fastapi import APIRouter, Depends

from app.modules.iam.deps import require_permission
from app.modules.iam.permissions import services as permission_service
from app.modules.iam.permissions.schema import (
    PermissionPublic,
    PermissionsPublic,
)
from app.shared.deps import SessionDep
from app.shared.pagination import PaginationDep

router = APIRouter(
    prefix="/permissions",
    tags=["permissions"],
    dependencies=[Depends(require_permission("permissions:read"))],
)


@router.get("/", response_model=PermissionsPublic)
def read_permissions(session: SessionDep, pagination: PaginationDep) -> Any:
    perms, count = permission_service.list_permissions(
        session=session, skip=pagination.skip, limit=pagination.limit
    )
    return PermissionsPublic(
        data=[PermissionPublic.model_validate(p) for p in perms], count=count
    )


@router.get("/{permission_id}", response_model=PermissionPublic)
def read_permission(session: SessionDep, permission_id: uuid.UUID) -> Any:
    return permission_service.get_permission(
        session=session, permission_id=permission_id
    )
