import uuid
from datetime import datetime, timezone

from sqlalchemy import Column, DateTime, Text
from sqlmodel import Field, Relationship, SQLModel

from app.modules.iam.users.models import User


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class OcrDocument(SQLModel, table=True):
    __tablename__ = "ocr_document"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    created_at: datetime | None = Field(
        default_factory=_utcnow,
        sa_type=DateTime(timezone=True),  # type: ignore
    )
    completed_at: datetime | None = Field(
        default=None,
        sa_type=DateTime(timezone=True),  # type: ignore
    )

    # File metadata
    original_filename: str = Field(max_length=500)
    mime_type: str = Field(max_length=100)
    file_size_bytes: int = Field(default=0)
    page_count: int | None = Field(default=None)
    minio_key: str = Field(max_length=1000)

    # OCR results. Rows are always created with an explicit status; the
    # default only covers direct construction.
    status: str = Field(default="processing", max_length=20)
    document_type: str | None = Field(default=None, max_length=50)
    extracted_text: str | None = Field(default=None, sa_column=Column(Text))
    provider_used: str | None = Field(default=None, max_length=50)
    processing_time_ms: int | None = Field(default=None)
    error_message: str | None = Field(default=None, sa_column=Column(Text))

    # Ownership
    owner_id: uuid.UUID = Field(
        foreign_key="user.id", nullable=False, ondelete="CASCADE", index=True
    )
    tenant_id: uuid.UUID = Field(
        foreign_key="tenant.id", nullable=False, ondelete="CASCADE", index=True
    )
    owner: User | None = Relationship()
