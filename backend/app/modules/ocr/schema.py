import uuid
from datetime import datetime
from enum import Enum

from sqlmodel import Field, SQLModel


class OcrStatus(str, Enum):
    PROCESSING = "processing"
    COMPLETED = "completed"
    FAILED = "failed"


class OcrDocumentBase(SQLModel):
    original_filename: str = Field(max_length=500)
    mime_type: str = Field(max_length=100)


class OcrDocumentPublic(OcrDocumentBase):
    id: uuid.UUID
    status: OcrStatus
    document_type: str | None = None
    extracted_text: str | None = None
    provider_used: str | None = None
    page_count: int | None = None
    processing_time_ms: int | None = None
    # Generic, client-safe failure text only; the underlying exception is
    # logged server-side and never surfaced here. minio_key is deliberately
    # omitted — it embeds internal storage layout and the owner's UUID.
    error_message: str | None = None
    file_size_bytes: int = 0
    owner_id: uuid.UUID
    created_at: datetime | None = None
    completed_at: datetime | None = None


class OcrDocumentsPublic(SQLModel):
    data: list[OcrDocumentPublic]
    count: int
