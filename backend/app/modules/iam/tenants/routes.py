import uuid
from typing import Any

from fastapi import APIRouter, Depends

from app.modules.iam.deps import require_permission
from app.modules.iam.tenants import services as tenant_service
from app.modules.iam.tenants.schema import TenantPublic, TenantsPublic
from app.shared.deps import SessionDep
from app.shared.pagination import PaginationDep

router = APIRouter(
    prefix="/tenants",
    tags=["tenants"],
    dependencies=[Depends(require_permission("tenants:read"))],
)


@router.get("/", response_model=TenantsPublic)
def read_tenants(session: SessionDep, pagination: PaginationDep) -> Any:
    tenants, count = tenant_service.list_tenants(
        session=session, skip=pagination.skip, limit=pagination.limit
    )
    return TenantsPublic(
        data=[TenantPublic.model_validate(t) for t in tenants], count=count
    )


@router.get("/{tenant_id}", response_model=TenantPublic)
def read_tenant(session: SessionDep, tenant_id: uuid.UUID) -> Any:
    return tenant_service.get_tenant(session=session, tenant_id=tenant_id)
