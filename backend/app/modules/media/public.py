"""Cross-module contract of the media module."""

import uuid
from typing import Literal

from sqlmodel import col, select

from app.modules.media import storage
from app.modules.media.models import MediaObject
from app.shared import owned_repo
from app.shared.context import Ctx
from app.shared.domain import invalid, not_found

MediaKind = Literal["image", "video", "audio", "file"]


def require_ready(
    ctx: Ctx, media_id: uuid.UUID, *, kinds: tuple[MediaKind, ...] = ("image",)
) -> MediaObject:
    """The caller's uploaded, byte-verified media object of an allowed kind.
    404 when missing or not the caller's; 422 ``media_not_ready`` otherwise."""
    media = owned_repo.get(ctx, MediaObject, media_id)
    if media is None:
        raise not_found("media")
    if media.state != "ready":
        raise invalid("media_not_ready", "That upload has not finished")
    if media.kind not in kinds:
        raise invalid("media_wrong_kind", "That file is the wrong type here")
    return media


def read_bytes(media: MediaObject, *, max_bytes: int | None = None) -> bytes:
    if max_bytes is not None and media.size_bytes > max_bytes:
        raise invalid("media_too_large", "That file is too large")
    return storage.read(media.storage_key)


def download_url(media: MediaObject) -> str:
    """A short-lived presigned GET URL."""
    return storage.presign_get(media.storage_key)


def visible_download_url(ctx: Ctx, media_id: uuid.UUID) -> str:
    """Presigned GET for media the caller may see but does not own (social:
    a followed user's post photo). Visibility is checked by the caller; this
    only refuses media outside the caller's tenant or not ready."""
    media = ctx.session.exec(
        select(MediaObject).where(
            MediaObject.id == media_id,
            MediaObject.tenant_id == ctx.tenant_id,
            MediaObject.state == "ready",
            col(MediaObject.deleted_at).is_(None),
        )
    ).first()
    if media is None:
        raise not_found("media")
    return storage.presign_get(media.storage_key)
