import uuid

from sqlmodel import Session, col, func, select

from app.modules.iam.tenants.models import Tenant


def get_by_id(*, session: Session, tenant_id: uuid.UUID) -> Tenant | None:
    return session.get(Tenant, tenant_id)


def get_by_slug(*, session: Session, slug: str) -> Tenant | None:
    return session.exec(select(Tenant).where(Tenant.slug == slug)).first()


def get_multi(
    *, session: Session, skip: int = 0, limit: int = 100
) -> tuple[list[Tenant], int]:
    count = session.exec(select(func.count()).select_from(Tenant)).one()
    tenants = session.exec(
        select(Tenant).order_by(col(Tenant.name)).offset(skip).limit(limit)
    ).all()
    return list(tenants), count


def create(*, session: Session, tenant: Tenant) -> Tenant:
    session.add(tenant)
    session.commit()
    session.refresh(tenant)
    return tenant
