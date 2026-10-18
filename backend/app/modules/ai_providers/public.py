"""Cross-module AI contract: which model serves a purpose for this user.

Every AI call in the product (capture interpretation, photo, voice, Sol, the
finance advisor) gets its model from :func:`resolve_model` and builds it with
:data:`model_factory`. ``model_factory`` is the ONE substitution seam for
tests: replace it with a factory returning a scripted fake chat model. Nothing
else patches LangChain.

Resolution order (ADR-0012): the user's assignment for the purpose -> the
server's default provider when ``AI_SERVER_FALLBACK`` is on -> ``None``, which
callers route to the deterministic rules engine.
"""

import uuid
from collections.abc import Callable
from dataclasses import dataclass
from typing import Literal

from langchain_core.language_models.chat_models import BaseChatModel
from pydantic import SecretStr
from sqlmodel import select

from app.core.config import settings
from app.modules.ai_providers.models import (
    AIModelAssignment,
    AIProviderCredential,
    AIUsage,
)
from app.shared import crypto
from app.shared.context import Ctx

Purpose = Literal["chat", "capture", "vision", "transcription", "advisor"]

# Base URLs of the OpenAI-compatible endpoints each preset speaks to.
PRESET_BASE_URLS: dict[str, str] = {
    "openrouter": "https://openrouter.ai/api/v1",
    "openai": "https://api.openai.com/v1",
    "anthropic": "https://api.anthropic.com/v1",
    "gemini": "https://generativelanguage.googleapis.com/v1beta/openai",
    "groq": "https://api.groq.com/openai/v1",
    "nebius": "https://api.studio.nebius.com/v1",
    "together": "https://api.together.xyz/v1",
}


@dataclass(frozen=True)
class ResolvedModel:
    purpose: Purpose
    provider: str
    model: str
    base_url: str
    api_key: SecretStr
    credential_id: uuid.UUID | None
    supports_vision: bool
    source: Literal["user", "server"]


def _openai_compatible(resolved: ResolvedModel) -> BaseChatModel:
    from langchain_openai import ChatOpenAI

    return ChatOpenAI(
        model=resolved.model,
        api_key=resolved.api_key,
        base_url=resolved.base_url,
        timeout=settings.AI_REQUEST_TIMEOUT_SECONDS,
        max_retries=1,
        stream_usage=True,
    )


ModelFactory = Callable[[ResolvedModel], BaseChatModel]
model_factory: ModelFactory = _openai_compatible


def build_chat_model(resolved: ResolvedModel) -> BaseChatModel:
    return model_factory(resolved)


def resolve_model(ctx: Ctx, purpose: Purpose) -> ResolvedModel | None:
    row = ctx.session.exec(
        select(AIModelAssignment, AIProviderCredential)
        .join(
            AIProviderCredential,
            AIProviderCredential.id == AIModelAssignment.credential_id,  # type: ignore[arg-type]
        )
        .where(
            AIModelAssignment.owner_id == ctx.user_id,
            AIModelAssignment.purpose == purpose,
            AIModelAssignment.deleted_at.is_(None),  # type: ignore[union-attr]
            AIProviderCredential.deleted_at.is_(None),  # type: ignore[union-attr]
        )
    ).first()
    if row is not None:
        assignment, cred = row
        try:
            key = crypto.unseal(
                crypto.Sealed(cred.key_ciphertext, cred.key_nonce, cred.key_version),
                owner_id=ctx.user_id,
            )
        except crypto.SecretUnavailable:
            return None
        return ResolvedModel(
            purpose=purpose,
            provider=cred.provider,
            model=assignment.model,
            base_url=cred.base_url,
            api_key=SecretStr(key),
            credential_id=cred.id,
            supports_vision=assignment.supports_vision,
            source="user",
        )
    if settings.AI_SERVER_FALLBACK:
        return _server_default(purpose)
    return None


def _server_default(purpose: Purpose) -> ResolvedModel | None:
    provider = settings.DEFAULT_LLM_PROVIDER
    if provider == "openrouter" and settings.OPENROUTER_API_KEY:
        key, model, base = (
            settings.OPENROUTER_API_KEY,
            settings.OPENROUTER_MODEL,
            settings.OPENROUTER_BASE_URL,
        )
    elif provider == "nebius" and settings.NEBIUS_API_KEY:
        key, model, base = (
            settings.NEBIUS_API_KEY,
            settings.NEBIUS_MODEL,
            settings.NEBIUS_BASE_URL,
        )
    else:
        return None
    return ResolvedModel(
        purpose=purpose,
        provider=provider,
        model=model,
        base_url=base,
        api_key=SecretStr(key),
        credential_id=None,
        supports_vision=False,
        source="server",
    )


def record_usage(
    ctx: Ctx,
    resolved: ResolvedModel,
    *,
    input_tokens: int,
    output_tokens: int,
    cost_minor: int = 0,
    ok: bool = True,
) -> None:
    """Meter one call. Flushes only; the calling use case commits."""
    ctx.session.add(
        AIUsage(
            **ctx.owned(),
            at=ctx.now,
            purpose=resolved.purpose,
            credential_id=resolved.credential_id,
            model=resolved.model,
            input_tokens=max(0, input_tokens),
            output_tokens=max(0, output_tokens),
            cost_minor=max(0, cost_minor),
            ok=ok,
        )
    )
    ctx.session.flush()
