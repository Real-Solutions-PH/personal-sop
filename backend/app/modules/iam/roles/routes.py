import uuid
from typing import Any

from fastapi import APIRouter, Depends

from app.modules.iam.deps import require_permission
from app.modules.iam.roles import services as role_service
from app.modules.iam.roles.schema import RolePublic, RolesPublic
from app.shared.deps import SessionDep
from app.shared.pagination import PaginationDep

router = APIRouter(
    prefix="/roles",
    tags=["roles"],
    dependencies=[Depends(require_permission("roles:read"))],
)


@router.get("/", response_model=RolesPublic)
def read_roles(session: SessionDep, pagination: PaginationDep) -> Any:
    roles, count = role_service.list_roles(
        session=session, skip=pagination.skip, limit=pagination.limit
    )
    return RolesPublic(data=[RolePublic.model_validate(r) for r in roles], count=count)


@router.get("/{role_id}", response_model=RolePublic)
def read_role(session: SessionDep, role_id: uuid.UUID) -> Any:
    return role_service.get_role(session=session, role_id=role_id)
