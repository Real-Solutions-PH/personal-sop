"""Tenant identity resolution for authenticated requests.

Every authenticated request can resolve a :class:`TenantContext` via
``TenantDep``; it is the single seam downstream code (rate limiting, RLS
session claims, auditing) uses to know *which tenant* is acting.
"""

import uuid
from dataclasses import dataclass
from typing import Annotated

from fastapi import Depends

from app.modules.iam.deps import CurrentUser


@dataclass(frozen=True)
class TenantContext:
    """Identity of the tenant (and acting user) behind a request."""

    tenant_id: uuid.UUID
    user_id: uuid.UUID


def get_tenant_context(current_user: CurrentUser) -> TenantContext:
    """Resolve the tenant context from the authenticated user."""
    return TenantContext(tenant_id=current_user.tenant_id, user_id=current_user.id)


TenantDep = Annotated[TenantContext, Depends(get_tenant_context)]
