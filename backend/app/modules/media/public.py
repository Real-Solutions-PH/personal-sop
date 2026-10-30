"""Cross-module contract of the media module."""

import uuid
from collections.abc import Iterable
from dataclasses import dataclass
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


@dataclass(frozen=True)
class VisibleMedia:
    """What a viewer needs to draw one photo: the full image's URL, its
    preview's URL (None for uploads made before previews existed), the
    inline placeholder and the stored size."""

    url: str
    preview_url: str | None
    lqip: str | None
    width: int | None
    height: int | None


def visible_media(
    ctx: Ctx, media_ids: Iterable[uuid.UUID]
) -> dict[uuid.UUID, VisibleMedia]:
    """``visible_download_url`` for a whole page: one query for the media
    and one for their previews, whatever the page holds. Visibility is checked
    by the caller; an id outside the tenant, not ready or deleted is absent
    from the result."""
    wanted = set(media_ids)
    if not wanted:
        return {}

    def ready(ids: set[uuid.UUID]) -> list[MediaObject]:
        return list(
            ctx.session.exec(
                select(MediaObject).where(
                    col(MediaObject.id).in_(ids),
                    MediaObject.tenant_id == ctx.tenant_id,
                    MediaObject.state == "ready",
                    col(MediaObject.deleted_at).is_(None),
                )
            ).all()
        )

    rows = ready(wanted)
    preview_ids = {m.preview_id for m in rows if m.preview_id}
    previews = {
        p.id: storage.presign_get(p.storage_key)
        for p in (ready(preview_ids) if preview_ids else [])
    }
    return {
        m.id: VisibleMedia(
            url=storage.presign_get(m.storage_key),
            preview_url=previews.get(m.preview_id) if m.preview_id else None,
            lqip=m.lqip,
            width=m.width,
            height=m.height,
        )
        for m in rows
    }


def sniff_audio(head: bytes) -> str | None:
    """The audio MIME type the bytes really are (m4a, mp3, wav, webm, aac),
    or None: the declared type of an upload is never trusted."""
    from app.modules.media.sniff import sniff

    mime = sniff(head)
    return mime if mime and mime.startswith("audio/") else None
