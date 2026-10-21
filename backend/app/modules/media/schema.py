import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

MediaKind = Literal["image", "video", "audio", "file"]


class UploadRequest(BaseModel):
    id: uuid.UUID | None = None
    kind: MediaKind
    mime: str = Field(min_length=3, max_length=80)
    size_bytes: int = Field(gt=0)
    width: int | None = Field(default=None, gt=0, le=20000)
    height: int | None = Field(default=None, gt=0, le=20000)
    duration_sec: float | None = Field(default=None, ge=0, le=36000)


class UploadTicket(BaseModel):
    """Upload the bytes with ``PUT upload_url`` and header
    ``Content-Type: <mime>``, then call ``POST /media/{id}/complete``."""

    id: uuid.UUID
    upload_url: str
    expires_in: int
    headers: dict[str, str]


class MediaPublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    kind: MediaKind
    mime: str
    size_bytes: int
    width: int | None
    height: int | None
    duration_sec: float | None
    state: Literal["pending", "ready", "rejected"]
    ready_at: datetime | None
    created_at: datetime


class MediaWithUrl(MediaPublic):
    url: str | None = None
