from collections.abc import Generator
from typing import Annotated

from fastapi import Depends
from sqlmodel import Session

from app.core.db import engine
from app.modules.iam.deps import CurrentUser, get_tenant_session


def get_tenant_scoped_session(
    current_user: CurrentUser,
) -> Generator[Session, None, None]:
    """Session for tenant-owned resources, choosing the engine by role.

    Regular users go through the app engine, where the database enforces
    row-level security and clamps them to their own tenant. Superusers are
    platform operators: they keep the owner engine (which bypasses RLS) so
    their cross-tenant reads still work — the same escape hatch the owner
    session gives the platform-admin routes.
    """
    if current_user.is_superuser:
        with Session(engine) as session:
            yield session
    else:
        yield from get_tenant_session(current_user)


TenantScopedSessionDep = Annotated[Session, Depends(get_tenant_scoped_session)]
