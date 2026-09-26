"""OCR provider factory selection + provider plumbing.

The docling-backed ``_extract_sync`` bodies are pragma-excluded (the
optional "ocr" extra is not installed in CI); everything around them —
factory selection, provider identity, suffix mapping, and the
``extract`` -> ``_extract_sync`` thread hop — is tested here.
"""

import asyncio

import pytest
from fastapi import HTTPException

from app.core.config import settings
from app.modules.ocr.providers import easyocr, granite, rapidocr
from app.modules.ocr.providers.base import OcrProvider, OcrResult
from app.modules.ocr.providers.factory import (
    get_ocr_provider,
    list_available_providers,
)

PROVIDERS = [
    (rapidocr.RapidOcrProvider, "rapidocr"),
    (easyocr.EasyOcrProvider, "easyocr"),
    (granite.GraniteProvider, "granite"),
]


@pytest.mark.parametrize(("cls", "name"), PROVIDERS)
def test_factory_returns_named_provider(cls: type[OcrProvider], name: str) -> None:
    provider = get_ocr_provider(name)
    assert isinstance(provider, cls)
    assert provider.name() == name


def test_factory_falls_back_to_settings_default() -> None:
    provider = get_ocr_provider(None)
    assert provider.name() == settings.OCR_DEFAULT_PROVIDER


def test_factory_unknown_provider_is_400() -> None:
    with pytest.raises(HTTPException) as exc_info:
        get_ocr_provider("tesseract")
    assert exc_info.value.status_code == 400
    assert "Unknown OCR provider" in exc_info.value.detail


def test_list_available_providers_matches_registry() -> None:
    assert list_available_providers() == ["rapidocr", "easyocr", "granite"]


@pytest.mark.parametrize(("cls", "name"), PROVIDERS)
def test_extract_delegates_to_sync_worker(
    cls: type[OcrProvider], name: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    result = OcrResult(
        raw_text="txt", markdown_text="md", page_count=1, provider_name=name
    )
    seen: list[tuple[bytes, str]] = []

    def fake_sync(_self: OcrProvider, file_bytes: bytes, mime_type: str) -> OcrResult:
        seen.append((file_bytes, mime_type))
        return result

    monkeypatch.setattr(cls, "_extract_sync", fake_sync)
    provider = cls()
    got = asyncio.run(provider.extract(b"bytes", "image/png"))
    assert got is result
    assert seen == [(b"bytes", "image/png")]


@pytest.mark.parametrize(
    "module", [rapidocr, easyocr, granite], ids=["rapidocr", "easyocr", "granite"]
)
def test_mime_to_suffix_mapping(module: object) -> None:
    mapper = module._mime_to_suffix  # type: ignore[attr-defined]
    assert mapper("application/pdf") == ".pdf"
    assert mapper("image/jpeg") == ".jpg"
    assert mapper("image/tiff") == ".tiff"
    assert mapper("image/png") == ".png"
    assert mapper("application/unknown") == ".png"  # fallback
