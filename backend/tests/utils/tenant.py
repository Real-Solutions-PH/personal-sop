"""A tenant of its own for each test.

Exercises, routines and foods are a catalog shared by every member of a
tenant. The suite keeps every user until it ends, so in the one default
tenant each test would meet every earlier test's catalog rows. Tests of the
catalog's users instead sign everyone up in a fresh tenant, whose catalog
starts empty (as a new tenant's does) and is shared by the users of that
test only."""

import uuid
from collections.abc import Iterator

import pytest
from sqlmodel import Session

from app.modules.iam.tenants.models import Tenant
from app.modules.iam.users.models import User
from tests.utils.user import create_auth_user


def fresh_tenant(db: Session) -> uuid.UUID:
    tag = uuid.uuid4().hex[:12]
    tenant = Tenant(name=f"test {tag}", slug=f"test-{tag}")
    db.add(tenant)
    db.commit()
    return tenant.id


def user_of_own_tenant(db: Session) -> User:
    """A user alone in a fresh tenant, for a module-scoped fixture (which
    is set up before the per-test ``own_tenant``)."""
    user, _ = create_auth_user(db, tenant_id=fresh_tenant(db))
    return user


@pytest.fixture(autouse=True)
def own_tenant(db: Session, monkeypatch: pytest.MonkeyPatch) -> Iterator[uuid.UUID]:
    tenant_id = fresh_tenant(db)
    monkeypatch.setattr("tests.utils.user.default_tenant_id", lambda _db: tenant_id)
    yield tenant_id
