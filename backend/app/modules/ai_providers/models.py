"""Per-user AI providers: credentials, model assignment per purpose, usage."""

import uuid
from datetime import datetime

from sqlalchemy import CheckConstraint, LargeBinary, String, UniqueConstraint
from sqlmodel import Field

from app.shared.owned import OwnedRow, enum_check, tstz

PROVIDER_PRESETS = (
    "openrouter",
    "openai",
    "anthropic",
    "gemini",
    "groq",
    "nebius",
    "together",
    "custom",
)
PURPOSES = ("chat", "capture", "vision", "transcription", "advisor", "embedding")


class AIProviderCredential(OwnedRow, table=True):
    """An API key the user brought. The key itself is sealed
    (``app.shared.crypto``): never selected into a response schema."""

    __tablename__ = "ai_provider_credential"
    __table_args__ = (
        enum_check("provider", PROVIDER_PRESETS, name="ck_ai_cred_provider"),
    )

    provider: str = Field(sa_type=String(12))  # type: ignore
    label: str = Field(max_length=60)
    base_url: str = Field(max_length=255)
    key_ciphertext: bytes = Field(sa_type=LargeBinary)
    key_nonce: bytes = Field(sa_type=LargeBinary)
    key_version: int = 1
    key_last4: str = Field(default="", max_length=4)
    verified_at: datetime | None = Field(default=None, sa_type=tstz())  # type: ignore
    last_error_code: str | None = Field(default=None, max_length=40)


class AIModelAssignment(OwnedRow, table=True):
    """Which credential + model serves each purpose for this user."""

    __tablename__ = "ai_model_assignment"
    __table_args__ = (
        UniqueConstraint("owner_id", "purpose", name="uq_ai_assignment_purpose"),
        enum_check("purpose", PURPOSES, name="ck_ai_assignment_purpose"),
    )

    purpose: str = Field(sa_type=String(14))  # type: ignore
    credential_id: uuid.UUID = Field(
        foreign_key="ai_provider_credential.id", ondelete="CASCADE", index=True
    )
    model: str = Field(max_length=120)
    supports_vision: bool = False


class AIUsage(OwnedRow, table=True):
    """One row per model call; cost is an estimate in centavos."""

    __tablename__ = "ai_usage"
    __table_args__ = (
        enum_check("purpose", PURPOSES, name="ck_ai_usage_purpose"),
        CheckConstraint(
            "input_tokens >= 0 AND output_tokens >= 0", name="ck_ai_usage_tokens"
        ),
        CheckConstraint("cost_minor >= 0", name="ck_ai_usage_cost"),
    )

    at: datetime = Field(sa_type=tstz(), index=True)  # type: ignore
    purpose: str = Field(sa_type=String(14))  # type: ignore
    credential_id: uuid.UUID | None = Field(
        default=None, foreign_key="ai_provider_credential.id", ondelete="SET NULL"
    )
    model: str = Field(max_length=120)
    input_tokens: int = 0
    output_tokens: int = 0
    cost_minor: int = 0
    ok: bool = True
