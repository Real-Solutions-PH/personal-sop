import uuid

from sqlmodel import Session

from app.modules.iam.tenants import repo as tenant_repo
from app.modules.iam.tenants.models import Tenant

# Fixed UUID for the bootstrap "default" tenant. The Alembic migration that
# introduced tenant scoping inserts the same row with this id, so seed
# and migration stay idempotent with each other. Runtime lookups go by slug
# (settings.DEFAULT_TENANT_SLUG), never by this constant.
DEFAULT_TENANT_ID = uuid.UUID("00000000-0000-4000-8000-000000000001")

DEFAULT_TENANTS: list[dict[str, str]] = [
    {"name": "Default", "slug": "default"},
]


def seed_tenants(session: Session) -> None:
    for entry in DEFAULT_TENANTS:
        if tenant_repo.get_by_slug(session=session, slug=entry["slug"]) is None:
            tenant = Tenant(**entry)
            if entry["slug"] == "default":
                tenant.id = DEFAULT_TENANT_ID
            tenant_repo.create(session=session, tenant=tenant)
