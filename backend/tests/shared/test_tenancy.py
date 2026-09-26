"""Unit tests for the tenant-context dependency."""

import dataclasses
import uuid

import pytest

from app.modules.iam.users.models import User
from app.shared.tenancy import TenantContext, get_tenant_context


def _user(tenant_id: uuid.UUID, user_id: uuid.UUID) -> User:
    return User(
        id=user_id,
        email="tenancy-unit@example.com",
        tenant_id=tenant_id,
    )


def test_get_tenant_context_resolves_ids_from_current_user() -> None:
    tenant_id = uuid.uuid4()
    user_id = uuid.uuid4()

    ctx = get_tenant_context(_user(tenant_id, user_id))

    assert ctx == TenantContext(tenant_id=tenant_id, user_id=user_id)


def test_tenant_context_is_immutable() -> None:
    ctx = TenantContext(tenant_id=uuid.uuid4(), user_id=uuid.uuid4())

    with pytest.raises(dataclasses.FrozenInstanceError):
        ctx.tenant_id = uuid.uuid4()  # type: ignore[misc]
