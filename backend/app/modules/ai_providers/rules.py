"""Pure rules for AI providers: presets, base-URL policy, outcome codes, the
model-list normaliser and the vision rule. No database, no network.
"""

import re
from dataclasses import dataclass
from typing import Any, Literal
from urllib.parse import urlsplit

from app.modules.ai_providers.public import PRESET_BASE_URLS

VerifyCode = Literal[
    "ok", "unauthorized", "not_found", "rate_limited", "unreachable", "bad_response"
]
VERIFY_CODES: tuple[VerifyCode, ...] = (
    "ok",
    "unauthorized",
    "not_found",
    "rate_limited",
    "unreachable",
    "bad_response",
)

LOCAL_HOSTS = frozenset({"localhost", "127.0.0.1"})
MAX_BASE_URL = 255
# A provider listing more models than this is cut; the response says so.
MAX_MODELS = 1000


@dataclass(frozen=True)
class Preset:
    name: str
    label: str
    default_base_url: str | None
    custom_base_url: bool
    vision_models: tuple[str, ...]


# Typical vision-capable models per preset: suggestions for the picker, not a
# whitelist (the provider's own list is the source of truth when it says so).
_VISION: dict[str, tuple[str, ...]] = {
    "openrouter": (
        "openai/gpt-4o-mini",
        "google/gemini-2.5-flash",
        "anthropic/claude-sonnet-4.5",
    ),
    "openai": ("gpt-4o", "gpt-4o-mini", "gpt-4.1", "gpt-4.1-mini"),
    "anthropic": ("claude-sonnet-4-5", "claude-haiku-4-5", "claude-opus-4-1"),
    "gemini": ("gemini-2.5-flash", "gemini-2.5-pro", "gemini-2.0-flash"),
    "groq": (
        "meta-llama/llama-4-scout-17b-16e-instruct",
        "meta-llama/llama-4-maverick-17b-128e-instruct",
    ),
    "nebius": ("Qwen/Qwen2.5-VL-72B-Instruct", "google/gemma-3-27b-it"),
    "together": (
        "meta-llama/Llama-4-Maverick-17B-128E-Instruct-FP8",
        "Qwen/Qwen2.5-VL-72B-Instruct",
    ),
    "custom": ("llava", "llama3.2-vision", "qwen2.5vl"),
}

_LABELS: dict[str, str] = {
    "openrouter": "OpenRouter",
    "openai": "OpenAI",
    "anthropic": "Anthropic",
    "gemini": "Google Gemini",
    "groq": "Groq",
    "nebius": "Nebius",
    "together": "Together AI",
    "custom": "Custom (OpenAI-compatible)",
}

PRESETS: tuple[Preset, ...] = tuple(
    Preset(
        name=name,
        label=_LABELS[name],
        default_base_url=PRESET_BASE_URLS.get(name),
        custom_base_url=name == "custom",
        vision_models=_VISION[name],
    )
    for name in (*PRESET_BASE_URLS, "custom")
)


class BaseUrlRejected(ValueError):
    """The base URL breaks the policy. ``code`` is stable; the message never
    quotes the submitted URL."""

    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


def validate_base_url(raw: str) -> str:
    """Normalise a custom preset's base URL or raise :class:`BaseUrlRejected`.

    ``https`` anywhere; plain ``http`` only for ``localhost``/``127.0.0.1``
    (Ollama, LM Studio). Userinfo, query and fragment are refused: the URL is
    a prefix ``/models`` and ``/chat/completions`` are appended to, and the
    key travels in a header, never in the URL. The checks run on the written
    form as well as the parsed one so a parser quirk cannot smuggle a host.
    """
    url = raw.strip()
    if not url or len(url) > MAX_BASE_URL:
        raise BaseUrlRejected("base_url_invalid")
    if re.search(r"[\s\\\x00-\x1f\x7f]", url):
        raise BaseUrlRejected("base_url_invalid")
    parts = urlsplit(url)
    scheme = parts.scheme.lower()
    if scheme not in ("https", "http"):
        raise BaseUrlRejected("base_url_scheme")
    if "@" in parts.netloc or parts.username is not None or parts.password:
        raise BaseUrlRejected("base_url_userinfo")
    if parts.query or parts.fragment or "?" in url or "#" in url:
        raise BaseUrlRejected("base_url_invalid")
    host = (parts.hostname or "").lower()
    if not host:
        raise BaseUrlRejected("base_url_invalid")
    try:
        _ = parts.port
    except ValueError as exc:
        raise BaseUrlRejected("base_url_invalid") from exc
    if scheme == "http" and host not in LOCAL_HOSTS:
        raise BaseUrlRejected("base_url_scheme")
    return f"{scheme}://{parts.netloc.lower()}{parts.path}".rstrip("/")


def code_for_status(status: int) -> VerifyCode:
    """Map the provider's HTTP status on ``GET /models`` to a stable code."""
    if 200 <= status < 300:
        return "ok"
    if status in (401, 403):
        return "unauthorized"
    if status == 404:
        return "not_found"
    if status == 429:
        return "rate_limited"
    # 3xx (redirects are never followed: the key must not travel to another
    # host), other 4xx, 5xx.
    return "bad_response"


@dataclass(frozen=True)
class ModelInfo:
    id: str
    name: str
    supports_vision: bool | None


# Model-id fragments that reliably mean "accepts images" when the provider's
# listing carries no modality metadata. Only ever infers True.
_VISION_ID = re.compile(
    r"(gpt-4o|gpt-4\.1|gpt-5|claude-(3|sonnet|opus|haiku)|gemini"
    r"|gemma-3|llava|vision|[-_.]vl\b|vl-|pixtral|llama-4|llama4|qwen2\.5vl)",
    re.IGNORECASE,
)


def _vision_from_meta(item: dict[str, Any]) -> bool | None:
    arch = item.get("architecture")
    if isinstance(arch, dict):
        mods = arch.get("input_modalities")
        if isinstance(mods, list) and all(isinstance(m, str) for m in mods):
            return "image" in mods
        modality = arch.get("modality")
        if isinstance(modality, str) and "->" in modality:
            return "image" in modality.split("->", 1)[0]
    caps = item.get("capabilities")
    if isinstance(caps, dict) and isinstance(caps.get("vision"), bool):
        return bool(caps["vision"])
    mods = item.get("input_modalities")
    if isinstance(mods, list) and all(isinstance(m, str) for m in mods):
        return "image" in mods
    return None


def normalise_models(payload: Any) -> tuple[list[ModelInfo], bool] | None:
    """The provider's ``GET /models`` body as ``(models, truncated)``.

    Accepts the OpenAI shape ``{"data": [...]}`` and a bare list (Together).
    Returns ``None`` when the body is not a model list at all. Entries without
    a string id are skipped; ids are de-duplicated and sorted.
    """
    if isinstance(payload, dict):
        items = payload.get("data")
    else:
        items = payload
    if not isinstance(items, list):
        return None
    seen: dict[str, ModelInfo] = {}
    for item in items:
        if not isinstance(item, dict):
            continue
        model_id = item.get("id")
        if not isinstance(model_id, str) or not model_id.strip():
            continue
        model_id = model_id.strip()[:120]
        if model_id in seen:
            continue
        name = item.get("display_name") or item.get("name")
        vision = _vision_from_meta(item)
        if vision is None and _VISION_ID.search(model_id):
            vision = True
        seen[model_id] = ModelInfo(
            id=model_id,
            name=name.strip()[:200]
            if isinstance(name, str) and name.strip()
            else model_id,
            supports_vision=vision,
        )
    models = sorted(seen.values(), key=lambda m: m.id)
    return models[:MAX_MODELS], len(models) > MAX_MODELS


def vision_allowed(purpose: str, *, claimed: bool, listed: bool | None = None) -> bool:
    """Whether an assignment may be saved under the vision rule.

    A ``vision`` assignment needs ``supports_vision`` true, and a provider
    listing that explicitly says the model takes no images overrides the
    claim. Other purposes are never refused by this rule.
    """
    if purpose != "vision":
        return True
    if listed is False:
        return False
    return claimed
