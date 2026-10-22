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
import re
from typing import Any, TypeVar

import httpx
from langchain_core.messages import AIMessage, BaseMessage, HumanMessage, SystemMessage
from pydantic import BaseModel, ValidationError

from app.core.config import settings
from app.modules.ai_providers import public as ai
from app.shared.context import Ctx

M = TypeVar("M", bound=BaseModel)

AUDIO_MAX_BYTES = 25 * 1024 * 1024
IMAGE_MAX_BYTES = 10 * 1024 * 1024


class SeamError(Exception):
    """A provider or OCR call failed; ``code`` is safe to show."""

    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


def usage_of(msg: BaseMessage) -> tuple[int, int]:
    meta = getattr(msg, "usage_metadata", None) or {}
    return int(meta.get("input_tokens") or 0), int(meta.get("output_tokens") or 0)


def meter(
    ctx: Ctx, resolved: ai.ResolvedModel, msg: BaseMessage | None, *, ok: bool = True
) -> None:
    """One ``ai_usage`` row for one model call (flushes only)."""
    i, o = usage_of(msg) if msg is not None else (0, 0)
    ai.record_usage(
        ctx,
        resolved,
        input_tokens=i,
        output_tokens=o,
        cost_minor=ai.price_minor(resolved.model, i, o),
        ok=ok,
    )


def ask_text(
    ctx: Ctx,
    resolved: ai.ResolvedModel,
    *,
    system: str,
    text: str,
    images: list[tuple[bytes, str]],
) -> str:
    """One metered call that answers in plain text, with ``images`` in the
    same message."""
    model = ai.build_chat_model(resolved)
    content: list[str | dict[Any, Any]] = [{"type": "text", "text": text}]
    for data, mime in images:
        url = f"data:{mime};base64,{base64.b64encode(data).decode()}"
        content.append({"type": "image_url", "image_url": {"url": url}})
    msgs: list[BaseMessage] = [SystemMessage(system), HumanMessage(content=content)]
    try:
        out = model.invoke(msgs)
    except Exception:  # noqa: BLE001 - provider failures become a stable code
        meter(ctx, resolved, None, ok=False)
        raise SeamError("model_unavailable") from None
    meter(ctx, resolved, out if isinstance(out, AIMessage) else None)
    return text_of(out).strip()


# ---------------------------------------------------------------- voice


def transcribe(
    resolved: ai.ResolvedModel,
    audio: bytes,
    *,
    filename: str,
    mime: str,
    language: str | None,
) -> str:
    """Speech to text: Deepgram's ``/listen`` when the resolved provider is
    Deepgram, otherwise ``POST {base_url}/audio/transcriptions`` (any
    OpenAI-compatible provider)."""
    if resolved.provider == "deepgram":
        return _deepgram(resolved, audio, mime=mime, language=language)
    data = {"model": resolved.model, "response_format": "json"}
    if language:
        data["language"] = language
    try:
        with httpx.Client(
            timeout=settings.AI_REQUEST_TIMEOUT_SECONDS, trust_env=False
        ) as c:
            r = c.post(
                f"{resolved.base_url.rstrip('/')}/audio/transcriptions",
                headers={
                    "Authorization": f"Bearer {resolved.api_key.get_secret_value()}"
                },
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


def _deepgram(
    resolved: ai.ResolvedModel, audio: bytes, *, mime: str, language: str | None
) -> str:
    """Deepgram's pre-recorded API. ``tl`` (Taglish) goes as ``multi``, its
    code-switching mode; English as ``en``."""
    params = {
        "model": resolved.model,
        "smart_format": "true",
        "language": "multi" if language == "tl" else (language or "en"),
    }
    try:
        with httpx.Client(
            timeout=settings.AI_REQUEST_TIMEOUT_SECONDS, trust_env=False
        ) as c:
            r = c.post(
                f"{resolved.base_url.rstrip('/')}/listen",
                params=params,
                headers={
                    "Authorization": f"Token {resolved.api_key.get_secret_value()}",
                    "Content-Type": mime,
                },
                content=audio,
            )
    except httpx.HTTPError:
        raise SeamError("transcription_unreachable") from None
    if r.status_code != 200:
        raise SeamError("transcription_failed")
    try:
        alt = r.json()["results"]["channels"][0]["alternatives"][0]
        text = alt["transcript"]
    except (ValueError, KeyError, IndexError, TypeError):
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
    images: list[tuple[bytes, str]] | None = None,
) -> M:
    """One metered call that must answer JSON matching ``schema``. The
    images (``image`` or several in ``images``) go in the same message."""
    model = ai.build_chat_model(resolved)
    content: Any = text
    pics = images if images is not None else ([image] if image is not None else [])
    if pics:
        content = [{"type": "text", "text": text}] + [
            {
                "type": "image_url",
                "image_url": {
                    "url": f"data:{mime};base64,{base64.b64encode(data).decode()}"
                },
            }
            for data, mime in pics
        ]
    msgs: list[BaseMessage] = [SystemMessage(system), HumanMessage(content=content)]
    try:
        out = model.invoke(msgs)
    except Exception:  # noqa: BLE001 - provider failures become a stable code
        meter(ctx, resolved, None, ok=False)
        raise SeamError("model_unavailable") from None
    meter(ctx, resolved, out if isinstance(out, AIMessage) else None)
    return parse_json(text_of(out), schema)
