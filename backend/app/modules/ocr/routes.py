import uuid
from typing import Any

from fastapi import APIRouter, Depends, File, Query, UploadFile

from app.modules.iam.deps import CurrentUser, require_permission
from app.modules.ocr import services as ocr_service
from app.modules.ocr.providers.factory import list_available_providers
from app.modules.ocr.schema import OcrDocumentPublic, OcrDocumentsPublic
from app.shared.pagination import PaginationDep
from app.shared.rate_limit import rate_limited
from app.shared.schema import Message
from app.shared.tenant_session import TenantScopedSessionDep

router = APIRouter(prefix="/ocr", tags=["ocr"])


@router.post(
    "/upload",
    response_model=OcrDocumentPublic,
    dependencies=[rate_limited("ocr"), Depends(require_permission("ocr:write"))],
)
async def upload_document(
    *,
    session: TenantScopedSessionDep,
    current_user: CurrentUser,
    file: UploadFile = File(...),
    provider: str | None = Query(default=None, description="OCR provider to use"),
) -> Any:
    """Upload a document image and run OCR processing."""
    doc = await ocr_service.process_document(
        session=session,
        current_user=current_user,
        file=file,
        provider_name=provider,
    )
    return doc


@router.get(
    "/",
    response_model=OcrDocumentsPublic,
    dependencies=[Depends(require_permission("ocr:read"))],
)
def list_documents(
    session: TenantScopedSessionDep,
    current_user: CurrentUser,
    pagination: PaginationDep,
    status: str | None = Query(default=None, description="Filter by status"),
) -> Any:
    """List OCR documents for the current user."""
    docs, count = ocr_service.list_documents(
        session=session,
        current_user=current_user,
        status=status,
        skip=pagination.skip,
        limit=pagination.limit,
    )
    items = [OcrDocumentPublic.model_validate(d) for d in docs]
    return OcrDocumentsPublic(data=items, count=count)


@router.get(
    "/providers",
    response_model=list[str],
    dependencies=[Depends(require_permission("ocr:read"))],
)
def get_available_providers(
    current_user: CurrentUser,  # noqa: ARG001
) -> Any:
    """List available OCR providers."""
    return list_available_providers()


@router.get(
    "/{id}",
    response_model=OcrDocumentPublic,
    dependencies=[Depends(require_permission("ocr:read"))],
)
def get_document(
    session: TenantScopedSessionDep, current_user: CurrentUser, id: uuid.UUID
) -> Any:
    """Get a single OCR document by ID."""
    return ocr_service.get_document(
        session=session, current_user=current_user, doc_id=id
    )


@router.delete(
    "/{id}",
    dependencies=[rate_limited("ocr"), Depends(require_permission("ocr:write"))],
)
def delete_document(
    session: TenantScopedSessionDep, current_user: CurrentUser, id: uuid.UUID
) -> Message:
    """Delete an OCR document and its MinIO file."""
    ocr_service.delete_document(session=session, current_user=current_user, doc_id=id)
    return Message(message="OCR document deleted successfully")
