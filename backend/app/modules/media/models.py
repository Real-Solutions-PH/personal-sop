"""Uploaded media (photos, video, audio, statements) in object storage."""

from datetime import datetime

from sqlalchemy import BigInteger, CheckConstraint, String
from sqlmodel import Field

from app.shared.owned import OwnedRow, enum_check, tstz

MEDIA_KINDS = ("image", "video", "audio", "file")
MEDIA_STATES = ("pending", "ready", "rejected")


class MediaObject(OwnedRow, table=True):
    """``pending`` until the client confirms the upload and the server has
    sniffed the first bytes; only ``ready`` objects may be attached."""

    __tablename__ = "media_object"
    __table_args__ = (
        enum_check("kind", MEDIA_KINDS, name="ck_media_kind"),
        enum_check("state", MEDIA_STATES, name="ck_media_state"),
        CheckConstraint("size_bytes >= 0", name="ck_media_size"),
    )

    kind: str = Field(sa_type=String(6))  # type: ignore
    storage_key: str = Field(max_length=255, unique=True)
    mime: str = Field(max_length=80)
    size_bytes: int = Field(default=0, sa_type=BigInteger)
    width: int | None = None
    height: int | None = None
    duration_sec: float | None = None
    state: str = Field(default="pending", sa_type=String(8))  # type: ignore
    ready_at: datetime | None = Field(default=None, sa_type=tstz())  # type: ignore
