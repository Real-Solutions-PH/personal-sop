"""Cross-module contract of the media module (implemented by media)."""

import uuid
from typing import Literal

from app.modules.media.models import MediaObject
from app.shared.context import Ctx

MediaKind = Literal["image", "video", "audio", "file"]


def require_ready(
    ctx: Ctx, media_id: uuid.UUID, *, kinds: tuple[MediaKind, ...] = ("image",)
) -> MediaObject:
    """The caller's uploaded, byte-verified media object of an allowed kind.
    404 when missing or not the caller's; 422 ``media_not_ready`` otherwise."""
    raise NotImplementedError


def read_bytes(media: MediaObject, *, max_bytes: int | None = None) -> bytes:
    raise NotImplementedError


def download_url(media: MediaObject) -> str:
    """A short-lived presigned GET URL."""
    raise NotImplementedError


def visible_download_url(ctx: Ctx, media_id: uuid.UUID) -> str:
    """Presigned GET for media the caller may see but does not own (social:
    a followed user's post photo). Visibility is checked by the caller."""
    raise NotImplementedError
