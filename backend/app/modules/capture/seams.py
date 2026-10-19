"""The external calls capture makes, each behind one named function so a
test substitutes exactly that function (G-C-026):

- :func:`transcribe` — speech to text over the provider's OpenAI-compatible
  ``/audio/transcriptions`` endpoint;
- :func:`ocr_text` — text out of an image through the OCR module;
- chat and vision models come from ``ai_providers.public.model_factory``
  (the AI seam), metered here by :func:`meter`.

No exception text from a provider ever reaches a response or a frame: the
callers turn a failure into a stable error code.
"""

import asyncio
import base64
import json
import math
import re
from typing import Any, TypeVar

import httpx
from langchain_core.messages import AIMessage, BaseMessage, HumanMessage, SystemMessage
from pydantic import BaseModel, ValidationError

from app.core.config import settings
from app.modules.ai_providers import public as ai
from app.shared.context import Ctx

M = TypeVar("M", bound=BaseModel)

# Estimated price per 1,000 tokens in centavos: a blended rate between the
# small and the large hosted models, so the monthly cap bites in the right
# order of magnitude. ai_providers has no per-model price table yet.
INPUT_CENTAVOS_PER_1K = 10
OUTPUT_CENTAVOS_PER_1K = 50
# A transcription minute, priced like Whisper (~$0.006 at P56/$).
TRANSCRIBE_CENTAVOS_PER_MIN = 34
AUDIO_MAX_BYTES = 25 * 1024 * 1024
IMAGE_MAX_BYTES = 10 * 1024 * 1024


class SeamError(Exception):
    """A provider or OCR call failed; ``code`` is safe to show."""

    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


def estimate_cost(input_tokens: int, output_tokens: int) -> int:
    if input_tokens <= 0 and output_tokens <= 0:
        return 0
    raw = (input_tokens * INPUT_CENTAVOS_PER_1K + output_tokens * OUTPUT_CENTAVOS_PER_1K) / 1000
    return max(1, math.ceil(raw))


def usage_of(msg: BaseMessage) -> tuple[int, int]:
    meta = getattr(msg, "usage_metadata", None) or {}
    return int(meta.get("input_tokens") or 0), int(meta.get("output_tokens") or 0)


def meter(ctx: Ctx, resolved: ai.ResolvedModel, msg: BaseMessage | None, *, ok: bool = True) -> None:
    """One ``ai_usage`` row for one model call (flushes only)."""
    i, o = usage_of(msg) if msg is not None else (0, 0)
    ai.record_usage(
        ctx,
        resolved,
        input_tokens=i,
        output_tokens=o,
        cost_minor=estimate_cost(i, o),
        ok=ok,
    )


# ---------------------------------------------------------------- voice


def transcribe(
    resolved: ai.ResolvedModel, audio: bytes, *, filename: str, mime: str, language: str | None
) -> str:
    """Speech to text through ``POST {base_url}/audio/transcriptions``."""
    data = {"model": resolved.model, "response_format": "json"}
    if language:
        data["language"] = language
    try:
        with httpx.Client(timeout=settings.AI_REQUEST_TIMEOUT_SECONDS, trust_env=False) as c:
            r = c.post(
                f"{resolved.base_url.rstrip('/')}/audio/transcriptions",
                headers={"Authorization": f"Bearer {resolved.api_key.get_secret_value()}"},
                data=data,
                files={"file": (filename, audio, mime)},
            )
    except httpx.HTTPError:
        raise SeamError("transcription_unreachable") from None
    if r.status_code != 200:
        raise SeamError("transcription_failed")
    try:
        text = r.json().get("text")
    except ValueError:
        raise SeamError("transcription_failed") from None
    if not isinstance(text, str):
        raise SeamError("transcription_failed")
    return text.strip()


# ---------------------------------------------------------------- OCR


def ocr_text(image: bytes, mime: str) -> str | None:
    """Text from an image through the OCR module's default provider;
    ``None`` when OCR is unavailable on this server or read nothing."""
    try:
        from app.modules.ocr.providers.factory import get_ocr_provider

        provider = get_ocr_provider()
        result = asyncio.run(provider.extract(image, mime))
    except Exception:  # noqa: BLE001 - an OCR engine may be absent or fail; never fatal
        return None
    text = (result.raw_text or "").strip()
    return text or None


# ---------------------------------------------------------------- models


def text_of(msg: BaseMessage) -> str:
    c = msg.content
    if isinstance(c, str):
        return c
    parts = [p.get("text", "") if isinstance(p, dict) else str(p) for p in c]
    return "".join(parts)


_JSON = re.compile(r"\{.*\}", re.S)


def parse_json(text: str, schema: type[M]) -> M:
    m = _JSON.search(text)
    if m is None:
        raise SeamError("model_bad_output")
    try:
        return schema.model_validate(json.loads(m.group(0)))
    except (ValueError, ValidationError):
        raise SeamError("model_bad_output") from None


def ask_json(
    ctx: Ctx,
    resolved: ai.ResolvedModel,
    schema: type[M],
    *,
    system: str,
    text: str,
    image: tuple[bytes, str] | None = None,
) -> M:
    """One metered call that must answer JSON matching ``schema``."""
    model = ai.build_chat_model(resolved)
    content: Any = text
    if image is not None:
        b64 = base64.b64encode(image[0]).decode()
        content = [
            {"type": "text", "text": text},
            {"type": "image_url", "image_url": {"url": f"data:{image[1]};base64,{b64}"}},
        ]
    msgs: list[BaseMessage] = [SystemMessage(system), HumanMessage(content=content)]
    try:
        out = model.invoke(msgs)
    except Exception:  # noqa: BLE001 - provider failures become a stable code
        meter(ctx, resolved, None, ok=False)
        raise SeamError("model_unavailable") from None
    meter(ctx, resolved, out if isinstance(out, AIMessage) else None)
    return parse_json(text_of(out), schema)
