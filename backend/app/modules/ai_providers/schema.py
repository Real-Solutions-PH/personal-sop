"""Request and response schemas of the AI providers module.

The API key is write-only: request schemas take it as ``SecretStr`` (so a
repr or a validation error never shows it) and no response schema has a field
that could carry it or its ciphertext. Request schemas forbid unknown fields.
"""

import uuid
from datetime import datetime
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, SecretStr, field_validator

from app.modules.ai_providers.public import Purpose
from app.modules.ai_providers.rules import VerifyCode

Provider = Literal[
    "openrouter",
    "openai",
    "anthropic",
    "gemini",
    "groq",
    "nebius",
    "together",
    "custom",
]
Label = Annotated[str, Field(min_length=1, max_length=60)]
ModelId = Annotated[str, Field(min_length=1, max_length=120)]

MAX_KEY = 512


def _check_key(v: SecretStr | None) -> SecretStr | None:
    if v is None:
        return None
    raw = v.get_secret_value().strip()
    # Printable ASCII only: the key goes into an HTTP header. The message
    # never quotes the value.
    if not raw or len(raw) > MAX_KEY or any(not (33 <= ord(c) <= 126) for c in raw):
        raise ValueError("API key must be 1-512 printable characters without spaces")
    return SecretStr(raw)


class PresetOut(BaseModel):
    name: Provider
    label: str
    default_base_url: str | None
    custom_base_url: bool
    vision_models: list[str]


class PresetsOut(BaseModel):
    data: list[PresetOut]
    count: int


class CredentialCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: uuid.UUID | None = None
    provider: Provider
    label: Label | None = None
    base_url: str | None = Field(default=None, max_length=255)
    api_key: SecretStr

    @field_validator("api_key")
    @classmethod
    def check_key(cls, v: SecretStr | None) -> SecretStr | None:
        return _check_key(v)


class CredentialUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    label: Label | None = None
    base_url: str | None = Field(default=None, max_length=255)
    api_key: SecretStr | None = None

    @field_validator("api_key")
    @classmethod
    def check_key(cls, v: SecretStr | None) -> SecretStr | None:
        return _check_key(v)


class CredentialPublic(BaseModel):
    id: uuid.UUID
    provider: Provider
    label: str
    base_url: str
    key_last4: str
    verified_at: datetime | None
    last_error_code: str | None
    created_at: datetime
    updated_at: datetime


class CredentialsOut(BaseModel):
    data: list[CredentialPublic]
    count: int


class VerifyOut(BaseModel):
    code: VerifyCode
    ok: bool
    credential: CredentialPublic


class ModelOut(BaseModel):
    id: str
    name: str
    supports_vision: bool | None


class ModelsOut(BaseModel):
    data: list[ModelOut]
    count: int
    truncated: bool
    cached: bool


class AssignmentIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    credential_id: uuid.UUID
    model: ModelId
    supports_vision: bool = False


class AssignmentPublic(BaseModel):
    id: uuid.UUID
    purpose: Purpose
    credential_id: uuid.UUID
    model: str
    supports_vision: bool
    updated_at: datetime


class AssignmentsOut(BaseModel):
    data: list[AssignmentPublic]
    count: int


class UsageRow(BaseModel):
    purpose: Purpose
    model: str
    calls: int
    failed_calls: int
    input_tokens: int
    output_tokens: int
    cost_minor: int


class UsageOut(BaseModel):
    month: str
    data: list[UsageRow]
    count: int
    calls: int
    spend_minor: int
    spend_cap_minor: int
    remaining_minor: int
    cap_reached: bool
    ai_enabled: bool
