"""The tenant-scoped session dependency picks the engine by role.

Regular users go through the app engine (RLS enforced); superusers keep the
owner engine so their platform-operator, cross-tenant reads still work — the
owner engine bypasses RLS. This is the wiring the route cutover depends on, so
pin it directly (no live DB needed: only the engine binding is asserted).
"""

import uuid

from app.core.db import app_engine, engine
from app.db.models import User
from app.shared.tenant_session import get_tenant_scoped_session


def _user(*, is_superuser: bool) -> User:
    return User(
        id=uuid.uuid4(),
        email=f"{uuid.uuid4().hex}@example.com",
        tenant_id=uuid.uuid4(),
        is_superuser=is_superuser,
    )


def test_superuser_gets_the_owner_engine() -> None:
    gen = get_tenant_scoped_session(_user(is_superuser=True))
    session = next(gen)
    try:
        assert session.get_bind() is engine
    finally:
        gen.close()


def test_regular_user_gets_the_app_engine() -> None:
    gen = get_tenant_scoped_session(_user(is_superuser=False))
    session = next(gen)
    try:
        assert session.get_bind() is app_engine
    finally:
        gen.close()
