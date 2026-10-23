"""AI provider REST routes (ADR-0012): presets, the user's credentials, the
model assignment per purpose and the month's usage.

Reads need ``ai_providers:read``; writes need ``ai_providers:write`` and are
rate limited. The two routes that call the provider (verify, models) are rate
limited too. No response schema carries the key or its ciphertext.
"""

import uuid
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Query
from fastapi.responses import Response

from app.modules.ai_providers import schema as S
from app.modules.ai_providers import services
from app.modules.ai_providers.public import Purpose
from app.modules.iam.deps import require_permission
from app.shared.context import CtxDep
from app.shared.pagination import PaginationDep
from app.shared.rate_limit import guarded, rate_limited

router = APIRouter(prefix="/ai", tags=["ai-providers"])

READ = [Depends(require_permission("ai_providers:read"))]
WRITE = [
    rate_limited("ai_providers"),
    Depends(require_permission("ai_providers:write")),
]
OUTBOUND = [
    rate_limited("ai_providers"),
    Depends(require_permission("ai_providers:read")),
    # Calls the provider with the user's key: per-user and per-address budget.
    guarded("ai", "ai_providers"),
]


@router.get("/providers/presets", response_model=S.PresetsOut, dependencies=READ)
def presets() -> Any:
    return services.presets()


@router.get("/providers", response_model=S.CredentialsOut, dependencies=READ)
def list_credentials(ctx: CtxDep, page: PaginationDep) -> Any:
    return services.list_credentials(ctx, skip=page.skip, limit=page.limit)


@router.post(
    "/providers",
    response_model=S.CredentialPublic,
    status_code=201,
    dependencies=WRITE,
)
def create_credential(ctx: CtxDep, data: S.CredentialCreate) -> Any:
    return services.create_credential(ctx, data=data)


@router.get(
    "/providers/{credential_id}", response_model=S.CredentialPublic, dependencies=READ
)
def get_credential(ctx: CtxDep, credential_id: uuid.UUID) -> Any:
    return services.get_credential(ctx, credential_id=credential_id)


@router.patch(
    "/providers/{credential_id}", response_model=S.CredentialPublic, dependencies=WRITE
)
def update_credential(
    ctx: CtxDep, credential_id: uuid.UUID, data: S.CredentialUpdate
) -> Any:
    return services.update_credential(ctx, credential_id=credential_id, data=data)


@router.delete("/providers/{credential_id}", status_code=204, dependencies=WRITE)
def delete_credential(ctx: CtxDep, credential_id: uuid.UUID) -> Response:
    services.delete_credential(ctx, credential_id=credential_id)
    return Response(status_code=204)


@router.post(
    "/providers/{credential_id}/verify", response_model=S.VerifyOut, dependencies=WRITE
)
def verify_credential(ctx: CtxDep, credential_id: uuid.UUID) -> Any:
    return services.verify_credential(ctx, credential_id=credential_id)


@router.get(
    "/providers/{credential_id}/models",
    response_model=S.ModelsOut,
    dependencies=OUTBOUND,
)
def list_models(ctx: CtxDep, credential_id: uuid.UUID) -> Any:
    return services.list_models(ctx, credential_id=credential_id)


@router.get("/assignments", response_model=S.AssignmentsOut, dependencies=READ)
def list_assignments(ctx: CtxDep) -> Any:
    return services.list_assignments(ctx)


@router.put(
    "/assignments/{purpose}", response_model=S.AssignmentPublic, dependencies=WRITE
)
def put_assignment(ctx: CtxDep, purpose: Purpose, data: S.AssignmentIn) -> Any:
    return services.put_assignment(ctx, purpose=purpose, data=data)


@router.delete("/assignments/{purpose}", status_code=204, dependencies=WRITE)
def delete_assignment(ctx: CtxDep, purpose: Purpose) -> Response:
    services.delete_assignment(ctx, purpose=purpose)
    return Response(status_code=204)


@router.get("/usage", response_model=S.UsageOut, dependencies=READ)
def usage(
    ctx: CtxDep,
    month: Annotated[str | None, Query(pattern=r"^\d{4}-\d{2}$")] = None,
) -> Any:
    return services.usage(ctx, month=month)
