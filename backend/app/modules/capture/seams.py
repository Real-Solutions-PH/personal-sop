"""The external calls capture makes, each behind one named function so a
test substitutes exactly that function (G-C-026):

- :func:`transcribe` — speech to text: Deepgram's ``/listen``, or any
  provider's OpenAI-compatible ``/audio/transcriptions`` endpoint;
- :func:`ocr_text` — text out of an image through the OCR module;
- chat and vision models come from ``ai_providers.public.model_factory``
  (the AI seam), metered here by :func:`meter`.

No exception text from a provider ever reaches a response or a frame: the
callers turn a failure into a stable error code.
"""

import asyncio
import base64
import re
import time
from collections.abc import Sequence
from concurrent.futures import ThreadPoolExecutor, wait
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


class Calls:
    """Model calls running in threads, collected as they are needed:
    a caller can act on the first answers and leave a slower call it no
    longer needs. Every ``ai_usage`` row is written on the caller's thread
    (the request's session), once per call, by :meth:`answer` or
    :meth:`close`."""

    def __init__(self, *, system: str, workers: int = 6) -> None:
        self.system = system
        self.pool = ThreadPoolExecutor(max_workers=workers)
        self.jobs: list[tuple[ai.ResolvedModel, Any]] = []
        self.answers: dict[int, str | None] = {}

    def start(
        self, r: ai.ResolvedModel, text: str, images: list[tuple[bytes, str]]
    ) -> int:
        content: list[str | dict[Any, Any]] = [{"type": "text", "text": text}]
        for data, mime in images:
            url = f"data:{mime};base64,{base64.b64encode(data).decode()}"
            content.append({"type": "image_url", "image_url": {"url": url}})
        msgs = [SystemMessage(self.system), HumanMessage(content=content)]
        self.jobs.append((r, self.pool.submit(ai.build_chat_model(r).invoke, msgs)))
        return len(self.jobs) - 1

    def wait(self, ids: Sequence[int], deadline: float) -> None:
        """Until every call in ``ids`` ended or ``deadline`` (monotonic)."""
        left = max(0.0, deadline - time.monotonic())
        wait([self.jobs[i][1] for i in ids], timeout=left)

    def answer(self, ctx: Ctx, i: int) -> str | None:
        """Call ``i``'s answer once it ended (None while it runs, or when it
        failed or said nothing); metered the first time it is read done."""
        if i in self.answers:
            return self.answers[i]
        r, f = self.jobs[i]
        if not f.done():
            return None
        msg = f.result() if f.exception() is None else None
        meter(ctx, r, msg if isinstance(msg, AIMessage) else None, ok=msg is not None)
        self.answers[i] = (text_of(msg).strip() or None) if msg is not None else None
        return self.answers[i]

    def close(self, ctx: Ctx) -> None:
        """Meter what was never read and stop waiting for it."""
        for i, (r, f) in enumerate(self.jobs):
            if i in self.answers:
                continue
            if f.done():
                self.answer(ctx, i)
            else:
                f.cancel()
                meter(ctx, r, None, ok=False)
        self.pool.shutdown(wait=False, cancel_futures=True)


# ---------------------------------------------------------------- voice

# Deepgram's speak endpoint takes up to 2,000 characters per request.
SPEAK_CHUNK = 1800


def _chunks(text: str, size: int = SPEAK_CHUNK) -> list[str]:
    """``text`` in pieces under ``size``, split after sentences when it can."""
    out: list[str] = []
    rest = text.strip()
    while len(rest) > size:
        cut = max(rest.rfind(p, 0, size) for p in (". ", "! ", "? ", "\n"))
        cut = cut + 1 if cut > size // 2 else size
        out.append(rest[:cut].strip())
        rest = rest[cut:].strip()
    if rest:
        out.append(rest)
    return out


def speak(resolved: ai.ResolvedModel, text: str) -> bytes:
    """Text to speech (Deepgram Aura), as MP3. Long text is spoken in
    pieces whose MP3 frames play back to back."""
    audio = b""
    try:
        with httpx.Client(
            timeout=settings.AI_REQUEST_TIMEOUT_SECONDS, trust_env=False
        ) as c:
            for piece in _chunks(text):
                r = c.post(
                    f"{resolved.base_url.rstrip('/')}/speak",
                    params={"model": resolved.model, "encoding": "mp3"},
                    headers={
                        "Authorization": f"Token {resolved.api_key.get_secret_value()}",
                        "Content-Type": "application/json",
                    },
                    json={"text": piece},
                )
                if r.status_code != 200:
                    raise SeamError("speech_failed")
                audio += r.content
    except httpx.HTTPError:
        raise SeamError("speech_unreachable") from None
    return audio


def transcribe(
    resolved: ai.ResolvedModel,
    audio: bytes,
    *,
    filename: str,
    mime: str,
    language: str | None,
    keyterms: Sequence[str] = (),
) -> str:
    """Speech to text: Deepgram's ``/listen`` when the resolved provider is
    Deepgram, otherwise ``POST {base_url}/audio/transcriptions`` (any
    OpenAI-compatible provider). ``keyterms`` are words to expect (see
    ``capture.vocabulary``); only Deepgram takes them."""
    if resolved.provider == "deepgram":
        return _deepgram(
            resolved, audio, mime=mime, language=language, keyterms=keyterms
        )
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


def deepgram_params(
    model: str, language: str | None, keyterms: Sequence[str]
) -> list[tuple[str, str]]:
    """The ``/listen`` query. ``tl`` (Taglish) goes as ``multi``, Nova-3's
    code-switching mode: its Tagalog-only ``tl`` model misheard the English
    half, numbers and names (30% word errors against 18%); English as
    ``en``. Each key term is its own ``keyterm`` parameter."""
    lang = "multi" if language == "tl" else (language or "en")
    params = [("model", model), ("smart_format", "true"), ("language", lang)]
    return params + [("keyterm", t) for t in keyterms]


# Nova-3's ``multi`` mode formats a spoken "600,000 pesos" as another
# country's peso code ("MXN600000", "ARS600000"): 11 of 350 test clips.
# Pesos here are Philippine pesos.
_FOREIGN_PESO = re.compile(
    r"\b(?:MXN|ARS|CLP|COP|UYU|DOP|CUP|PHP) ?(\d[\d,]*(?:\.\d+)?)"
)


def _peso(m: re.Match[str]) -> str:
    whole, _, cents = m.group(1).replace(",", "").partition(".")
    return f"₱{int(whole):,}" + (f".{cents}" if cents else "")


def tidy_transcript(text: str) -> str:
    """A transcript as the person would write it: a peso amount in pesos."""
    return _FOREIGN_PESO.sub(_peso, text).strip()


def _deepgram(
    resolved: ai.ResolvedModel,
    audio: bytes,
    *,
    mime: str,
    language: str | None,
    keyterms: Sequence[str],
) -> str:
    """Deepgram's pre-recorded API."""
    params = deepgram_params(resolved.model, language, keyterms)
    try:
        with httpx.Client(
            timeout=settings.AI_REQUEST_TIMEOUT_SECONDS, trust_env=False
        ) as c:
            r = c.post(
                f"{resolved.base_url.rstrip('/')}/listen",
                params=tuple(params),
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
    return tidy_transcript(text)


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


def parse_json(text: str, schema: type[M]) -> M:
    from app.modules.capture.photo_read import json_object

    obj = json_object(text)
    if obj is None:
        raise SeamError("model_bad_output")
    try:
        return schema.model_validate(obj)
    except ValidationError:
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
