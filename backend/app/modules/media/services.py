"""Media use cases: presigned upload, byte-verified completion, read, delete.

The API is never in the byte path. ``complete`` reads only the first bytes
back from storage and decides the type from them (``sniff``); an object whose
bytes do not prove an allowed type is deleted and marked ``rejected``.
"""

import uuid

from app.core.config import settings
from app.modules.media import sniff, storage
from app.modules.media.models import MediaObject
from app.modules.media.schema import UploadRequest, UploadTicket
from app.shared import owned_repo
from app.shared.context import Ctx
from app.shared.domain import invalid

MB = 1024 * 1024


def size_cap(kind: str) -> int:
    return {
        "image": settings.MEDIA_MAX_IMAGE_MB,
        "video": settings.MEDIA_MAX_VIDEO_MB,
        "audio": settings.MEDIA_MAX_AUDIO_MB,
        "file": settings.MEDIA_MAX_FILE_MB,
    }[kind] * MB


def request_upload(ctx: Ctx, data: UploadRequest) -> UploadTicket:
    if data.mime not in sniff.ALLOWED[data.kind]:
        raise invalid("media_type_not_allowed", "That file type is not supported")
    if data.size_bytes > size_cap(data.kind):
        raise invalid("media_too_large", "That file is too large")
    media_id = data.id or uuid.uuid4()
    existing = owned_repo.get(ctx, MediaObject, media_id)
    if existing is not None and existing.state != "pending":
        raise invalid("media_already_uploaded", "That upload is already complete")
    key = f"u/{ctx.user_id}/{media_id}"
    values = {
        "kind": data.kind,
        "storage_key": key,
        "mime": data.mime,
        "size_bytes": data.size_bytes,
        "width": data.width,
        "height": data.height,
        "duration_sec": data.duration_sec,
        "state": "pending",
    }
    if existing is None:
        owned_repo.insert(ctx, MediaObject, values, row_id=media_id)
    else:
        owned_repo.apply(existing, values)
        ctx.session.add(existing)
    url = storage.presign_put(key, data.mime, data.size_bytes)
    ctx.commit()
    return UploadTicket(
        id=media_id,
        upload_url=url,
        expires_in=settings.MEDIA_URL_TTL_SECONDS,
        headers={"Content-Type": data.mime},
    )


def complete_upload(ctx: Ctx, media_id: uuid.UUID) -> MediaObject:
    media = owned_repo.require(ctx, MediaObject, media_id, what="media")
    if media.state != "pending":
        return media  # idempotent: a retried complete returns the verdict
    meta = storage.head(media.storage_key)
    if meta is None:
        raise invalid("media_not_uploaded", "The file has not been uploaded yet")
    size = int(meta.get("ContentLength", 0))
    proven = sniff.sniff(storage.read(media.storage_key, first=sniff.HEAD_BYTES))
    if size > size_cap(media.kind) or not sniff.accepts(media.kind, proven):
        storage.delete(media.storage_key)
        media.state = "rejected"
    else:
        media.state = "ready"
        media.mime = proven or media.mime
        media.size_bytes = size
        media.ready_at = ctx.now
    ctx.session.add(media)
    ctx.commit()
    ctx.session.refresh(media)
    return media


def get_media(ctx: Ctx, media_id: uuid.UUID) -> MediaObject:
    return owned_repo.require(ctx, MediaObject, media_id, what="media")


def delete_media(ctx: Ctx, media_id: uuid.UUID) -> None:
    media = owned_repo.require(ctx, MediaObject, media_id, what="media")
    owned_repo.soft_delete(ctx, media)
    storage.delete(media.storage_key)
    ctx.commit()


def store_bytes(
    ctx: Ctx, *, kind: str, mime: str, data: bytes, media_id: uuid.UUID | None = None
) -> MediaObject:
    """Server-side create (e.g. a rendered share card). Same sniff rule."""
    proven = sniff.sniff(data[: sniff.HEAD_BYTES])
    if not sniff.accepts(kind, proven) or len(data) > size_cap(kind):
        raise invalid("media_type_not_allowed", "That file type is not supported")
    media_id = media_id or uuid.uuid4()
    key = f"u/{ctx.user_id}/{media_id}"
    storage.put(key, data, proven or mime)
    return owned_repo.insert(
        ctx,
        MediaObject,
        {
            "kind": kind,
            "storage_key": key,
            "mime": proven or mime,
            "size_bytes": len(data),
            "state": "ready",
            "ready_at": ctx.now,
        },
        row_id=media_id,
    )
