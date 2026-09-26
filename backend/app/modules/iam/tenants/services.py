import uuid

from fastapi import HTTPException
from sqlmodel import Session

from app.core.config import settings
from app.modules.iam.tenants import repo as tenant_repo
from app.modules.iam.tenants.models import Tenant


def get_default_tenant(*, session: Session) -> Tenant:
    """Tenant that new signups are assigned to. Seeded by init_db/migration."""
    tenant = tenant_repo.get_by_slug(session=session, slug=settings.DEFAULT_TENANT_SLUG)
    if tenant is None:
        raise RuntimeError(
            f"Default tenant (slug={settings.DEFAULT_TENANT_SLUG!r}) is missing; "
            "run migrations / init_db first."
        )
    return tenant


def list_tenants(
    *, session: Session, skip: int = 0, limit: int = 100
) -> tuple[list[Tenant], int]:
    return tenant_repo.get_multi(session=session, skip=skip, limit=limit)


def get_tenant(*, session: Session, tenant_id: uuid.UUID) -> Tenant:
    tenant = tenant_repo.get_by_id(session=session, tenant_id=tenant_id)
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")
    return tenant
