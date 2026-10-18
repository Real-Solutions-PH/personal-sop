import uuid

from fastapi import APIRouter, Depends

from app.modules.iam.deps import require_permission
from app.modules.media import public, services
from app.modules.media.schema import MediaWithUrl, UploadRequest, UploadTicket
from app.shared.context import CtxDep
from app.shared.rate_limit import rate_limited
from app.shared.schema import Message

router = APIRouter(prefix="/media", tags=["media"])

READ = [Depends(require_permission("media:read"))]
WRITE = [rate_limited("media"), Depends(require_permission("media:write"))]


def _out(media: object) -> MediaWithUrl:
    out = MediaWithUrl.model_validate(media)
    if out.state == "ready":
        out.url = public.download_url(media)  # type: ignore[arg-type]
    return out


@router.post("/uploads", response_model=UploadTicket, dependencies=WRITE)
def request_upload(ctx: CtxDep, body: UploadRequest) -> UploadTicket:
    return services.request_upload(ctx, body)


@router.post("/{media_id}/complete", response_model=MediaWithUrl, dependencies=WRITE)
def complete_upload(ctx: CtxDep, media_id: uuid.UUID) -> MediaWithUrl:
    return _out(services.complete_upload(ctx, media_id))


@router.get("/{media_id}", response_model=MediaWithUrl, dependencies=READ)
def read_media(ctx: CtxDep, media_id: uuid.UUID) -> MediaWithUrl:
    return _out(services.get_media(ctx, media_id))


@router.delete("/{media_id}", dependencies=WRITE)
def delete_media(ctx: CtxDep, media_id: uuid.UUID) -> Message:
    services.delete_media(ctx, media_id)
    return Message(message="Media deleted")
