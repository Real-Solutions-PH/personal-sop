"""Cross-module AI contract: which model serves a purpose for this user.

Every AI call in the product (capture interpretation, photo, voice, the companion, the
finance advisor) gets its model from :func:`resolve_model` and builds it with
:data:`model_factory`. ``model_factory`` is the ONE substitution seam for
tests: replace it with a factory returning a scripted fake chat model. Nothing
else patches LangChain.

Resolution order (ADR-0012): the user's assignment for the purpose -> the
server's default provider when ``AI_SERVER_FALLBACK`` is on -> ``None``, which
callers route to the deterministic rules engine.

Before any model call a caller runs :func:`check_budget`: it refuses with
403 ``ai_disabled`` when the user switched AI off and 402
``ai_spend_cap_reached`` once the month's metered spend reaches the cap
(``capture.ai_settings``). Callers that fall back to the rules engine catch
those two and route there; the order is check_budget -> resolve_model ->
build_chat_model -> record_usage.
"""

import math
import uuid
from collections.abc import Callable
from dataclasses import dataclass, replace
from datetime import date, datetime
from typing import Literal

from langchain_core.language_models.chat_models import BaseChatModel
from pydantic import SecretStr
from sqlmodel import col, func, select

from app.core.config import settings
from app.modules.ai_providers import catalog
from app.modules.ai_providers.models import (
    AIModelAssignment,
    AIProviderCredential,
    AIUsage,
)
from app.shared import crypto
from app.shared.context import Ctx
from app.shared.domain import domain_error

Purpose = Literal["chat", "capture", "vision", "transcription", "advisor", "embedding"]

# Base URLs of the OpenAI-compatible endpoints each preset speaks to.
PRESET_BASE_URLS: dict[str, str] = {
    "openrouter": "https://openrouter.ai/api/v1",
    "openai": "https://api.openai.com/v1",
    "anthropic": "https://api.anthropic.com/v1",
    "gemini": "https://generativelanguage.googleapis.com/v1beta/openai",
    "groq": "https://api.groq.com/openai/v1",
    "nebius": "https://api.tokenfactory.nebius.com/v1",
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


def _assignment(ctx: Ctx, purpose: Purpose) -> ResolvedModel | None:
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
    return None


def _vision_on_same_provider(ctx: Ctx) -> ResolvedModel | None:
    """Photos for a user who set up chat or capture on their own key but no
    vision model: their own model when it can see, else a known vision model
    on the same provider and key (Nebius: the catalogue's vision default).
    None when neither applies, and the server default decides."""
    for p in ("capture", "chat"):
        own = _assignment(ctx, p)
        if own is None:
            continue
        if own.supports_vision:
            return replace(own, purpose="vision")
        if own.provider == "nebius":
            return replace(
                own,
                purpose="vision",
                model=settings.NEBIUS_VISION_MODEL,
                supports_vision=True,
            )
    return None


def vision_readers(ctx: Ctx) -> list[ResolvedModel]:
    """The models that read a photo. The user's own vision model (or one on
    their own key) reads alone; on the server's Nebius key several read in
    parallel and vote (``NEBIUS_VISION_READERS``), with a vision model the
    user picked in settings first. Empty when nothing can see."""
    one = resolve_model(ctx, "vision")
    if one is None or not one.supports_vision:
        return []
    if one.source != "server" or one.provider != "nebius":
        return [one]
    names = [m.strip() for m in settings.NEBIUS_VISION_READERS.split(",")]
    order = [one.model, *(m for m in names if m and m != one.model)]
    return [replace(one, model=m) for m in order[:3]]


def resolve_model(ctx: Ctx, purpose: Purpose) -> ResolvedModel | None:
    own = _assignment(ctx, purpose)
    if own is not None:
        return own
    if purpose == "vision":
        same = _vision_on_same_provider(ctx)
        if same is not None:
            return same
    if settings.AI_SERVER_FALLBACK:
        return _server_default(purpose, _preferred_model(ctx))
    return None


def _preferred_model(ctx: Ctx) -> str | None:
    # Imported lazily: capture imports this module to resolve its models.
    from app.modules.capture import public as capture

    return capture.preferred_model(ctx)


def _server_default(
    purpose: Purpose, preferred: str | None = None
) -> ResolvedModel | None:
    if purpose == "transcription" and settings.DEEPGRAM_API_KEY:
        # Speech to text has its own provider (constitution §4.2).
        return ResolvedModel(
            purpose=purpose,
            provider="deepgram",
            model=settings.DEEPGRAM_MODEL,
            base_url=settings.DEEPGRAM_BASE_URL,
            api_key=SecretStr(settings.DEEPGRAM_API_KEY),
            credential_id=None,
            supports_vision=False,
            source="server",
        )
    provider = settings.DEFAULT_LLM_PROVIDER
    vision = False
    if provider == "openrouter" and settings.OPENROUTER_API_KEY:
        key, model, base = (
            settings.OPENROUTER_API_KEY,
            settings.OPENROUTER_MODEL,
            settings.OPENROUTER_BASE_URL,
        )
    elif provider == "nebius" and settings.NEBIUS_API_KEY:
        if purpose == "transcription":
            return None  # Token Factory serves no speech-to-text endpoint
        key, base = settings.NEBIUS_API_KEY, settings.NEBIUS_BASE_URL
        picked = catalog.find(preferred) if preferred else None
        if purpose == "vision":
            # The user's pick only when it can see; else the vision default.
            model = (
                picked.id
                if picked and picked.kind == "vision"
                else settings.NEBIUS_VISION_MODEL
            )
            vision = True
        else:
            model = picked.id if picked else settings.NEBIUS_MODEL
    else:
        return None
    return ResolvedModel(
        purpose=purpose,
        provider=provider,
        model=model,
        base_url=base,
        api_key=SecretStr(key),
        credential_id=None,
        supports_vision=vision,
        source="server",
    )


# Speech to text, USD per audio minute (Deepgram Nova-3 batch; OpenAI-
# compatible Whisper endpoints).
USD_PER_MIN = {"deepgram": 0.0043}
# Deepgram's keyterm prompting add-on, USD per audio minute (2026-10-23).
KEYTERM_USD_PER_MIN = {"deepgram": 0.0013}
USD_PER_MIN_DEFAULT = 0.006
# When a model has no catalogue price (a user's own provider), a deliberately
# generous blended rate in USD per million tokens: the cap should bite early
# rather than late.
USD_PER_M_FALLBACK = (1.0, 3.0)


def _centavos(usd: float) -> int:
    """USD to whole centavos, rounded up: a call that cost anything shows."""
    if usd <= 0:
        return 0
    return max(1, math.ceil(usd * settings.AI_USD_TO_PHP * 100))


def price_minor(model: str, input_tokens: int, output_tokens: int) -> int:
    """What one model call cost, in centavos, from the model's own price."""
    m = catalog.find(model)
    usd_in, usd_out = (m.usd_in, m.usd_out) if m else USD_PER_M_FALLBACK
    usd = (max(0, input_tokens) * usd_in + max(0, output_tokens) * usd_out) / 1e6
    return _centavos(usd)


# Deepgram Aura-2 text to speech, USD per 1,000 characters (2026-10-22).
TTS_USD_PER_1K_CHARS = 0.030


def speech_minor(chars: int) -> int:
    """What speaking ``chars`` characters aloud cost, in centavos."""
    return _centavos(max(0, chars) / 1000 * TTS_USD_PER_1K_CHARS)


# The width of every stored embedding: one model's vectors per column, so
# a changed model is re-embedded rather than mixed (``embed_model`` says
# which made a row).
EMBEDDING_DIMENSIONS = 1024


class EmbedError(Exception):
    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


def embedding_model(ctx: Ctx) -> ResolvedModel | None:
    """The model that embeds this user's memories: their own "embedding"
    assignment, else the server's (Nebius), else None (memories are kept
    unembedded and filled in later)."""
    own = _assignment(ctx, "embedding")
    if own is not None:
        return own
    if not (settings.AI_SERVER_FALLBACK and settings.NEBIUS_API_KEY):
        return None
    return ResolvedModel(
        purpose="embedding",
        provider="nebius",
        model=settings.NEBIUS_EMBEDDING_MODEL,
        base_url=settings.NEBIUS_BASE_URL,
        api_key=SecretStr(settings.NEBIUS_API_KEY),
        credential_id=None,
        supports_vision=False,
        source="server",
    )


def embed(ctx: Ctx, texts: list[str]) -> tuple[list[list[float]], str]:
    """``texts`` as vectors of EMBEDDING_DIMENSIONS, and the model that made
    them; one metered call. :class:`EmbedError` when no model resolves or
    the provider fails (no provider text in it)."""
    resolved = embedding_model(ctx)
    if resolved is None:
        raise EmbedError("no_embedding_model")
    vectors, tokens = embed_call(resolved, texts)
    record_usage(
        ctx,
        resolved,
        input_tokens=tokens,
        output_tokens=0,
        cost_minor=price_minor(resolved.model, tokens, 0),
    )
    return vectors, resolved.model


def embed_call(
    resolved: ResolvedModel, texts: list[str]
) -> tuple[list[list[float]], int]:
    """POST ``{base_url}/embeddings`` (OpenAI-compatible): the one seam a
    test substitutes. Returns the vectors in input order and the tokens
    billed."""
    import httpx

    try:
        with httpx.Client(
            timeout=settings.AI_REQUEST_TIMEOUT_SECONDS, trust_env=False
        ) as c:
            r = c.post(
                f"{resolved.base_url.rstrip('/')}/embeddings",
                headers={
                    "Authorization": f"Bearer {resolved.api_key.get_secret_value()}"
                },
                json={
                    "model": resolved.model,
                    "input": texts,
                    "dimensions": EMBEDDING_DIMENSIONS,
                },
            )
    except httpx.HTTPError:
        raise EmbedError("embedding_unreachable") from None
    if r.status_code != 200:
        raise EmbedError("embedding_failed")
    try:
        body = r.json()
        rows = sorted(body["data"], key=lambda d: d["index"])
        vectors = [[float(x) for x in d["embedding"]] for d in rows]
        tokens = int((body.get("usage") or {}).get("prompt_tokens") or 0)
    except (ValueError, KeyError, TypeError):
        raise EmbedError("embedding_failed") from None
    if len(vectors) != len(texts) or any(
        len(v) != EMBEDDING_DIMENSIONS for v in vectors
    ):
        raise EmbedError("embedding_wrong_shape")
    return vectors, tokens


def speech_model() -> ResolvedModel | None:
    """The server's text-to-speech voice (Deepgram), or None without a key.
    Metered under ``transcription``, the speech purpose, with its own
    model name."""
    if not settings.DEEPGRAM_API_KEY:
        return None
    return ResolvedModel(
        purpose="transcription",
        provider="deepgram",
        model=settings.DEEPGRAM_TTS_MODEL,
        base_url=settings.DEEPGRAM_BASE_URL,
        api_key=SecretStr(settings.DEEPGRAM_API_KEY),
        credential_id=None,
        supports_vision=False,
        source="server",
    )


def transcription_minor(
    provider: str, seconds: float, *, keyterms: bool = False
) -> int:
    """What transcribing ``seconds`` of audio cost, in centavos; with
    ``keyterms``, the provider's key-term add-on too."""
    rate = USD_PER_MIN.get(provider, USD_PER_MIN_DEFAULT)
    if keyterms:
        rate += KEYTERM_USD_PER_MIN.get(provider, 0.0)
    return _centavos(max(0.0, seconds) / 60 * rate)


def server_default_summary() -> dict[str, str] | None:
    """What the server key answers with when a user has no provider of their
    own (None when the fallback is off or has no key)."""
    if not settings.AI_SERVER_FALLBACK:
        return None
    text = _server_default("chat")
    if text is None:
        return None
    photo = _server_default("vision")
    return {
        "provider": text.provider,
        "model": text.model,
        "vision_model": photo.model if photo else text.model,
    }


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


# ---------------------------------------------------------------------------
# Budget (ADR-0012 section 5)
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class Budget:
    ai_enabled: bool
    spend_cap_minor: int
    spend_minor: int
    calls: int

    @property
    def cap_reached(self) -> bool:
        # Mirrors the prototype engine: spend >= cap refuses, so a cap of 0
        # means "no paid calls at all".
        return self.spend_minor >= self.spend_cap_minor


def month_window(ctx: Ctx, first_day: date) -> tuple[datetime, datetime]:
    """The user's business month containing ``first_day`` as a half-open UTC
    interval. Months follow the user's time zone and day-start hour."""
    start = first_day.replace(day=1)
    nxt = (
        start.replace(year=start.year + 1, month=1)
        if start.month == 12
        else start.replace(month=start.month + 1)
    )
    return ctx.clock.start_of(start), ctx.clock.start_of(nxt)


def _ai_settings(ctx: Ctx) -> tuple[bool, int]:
    # ai_settings is the capture module's table; it is read (never written)
    # here because the cap is enforced at the AI seam. A user with no row yet
    # gets the table's defaults.
    from app.modules.capture.models import AISettings

    row = ctx.session.exec(
        select(AISettings.ai_enabled, AISettings.spend_cap_minor).where(
            AISettings.owner_id == ctx.user_id,
            AISettings.tenant_id == ctx.tenant_id,
            col(AISettings.deleted_at).is_(None),
        )
    ).first()
    if row is None:
        defaults = AISettings.model_fields
        return bool(defaults["ai_enabled"].default), int(
            defaults["spend_cap_minor"].default
        )
    return bool(row[0]), int(row[1])


def budget(ctx: Ctx, month_of: date | None = None) -> Budget:
    enabled, cap = _ai_settings(ctx)
    start, end = month_window(ctx, month_of or ctx.today)
    spend, calls = ctx.session.exec(
        select(func.coalesce(func.sum(AIUsage.cost_minor), 0), func.count()).where(
            AIUsage.owner_id == ctx.user_id,
            AIUsage.tenant_id == ctx.tenant_id,
            col(AIUsage.deleted_at).is_(None),
            col(AIUsage.at) >= start,
            col(AIUsage.at) < end,
        )
    ).one()
    return Budget(
        ai_enabled=enabled,
        spend_cap_minor=cap,
        spend_minor=int(spend),
        calls=int(calls),
    )


def check_budget(ctx: Ctx) -> None:
    """Refuse a model call the user's settings do not allow.

    Raises 403 ``ai_disabled`` or 402 ``ai_spend_cap_reached``. Reads only.
    """
    b = budget(ctx)
    if not b.ai_enabled:
        raise domain_error(403, "ai_disabled", "AI is switched off in your settings.")
    if b.cap_reached:
        raise domain_error(
            402,
            "ai_spend_cap_reached",
            "This month's AI spend cap is reached. Raise the cap or wait for next month.",
        )
