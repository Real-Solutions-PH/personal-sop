from fastapi import HTTPException

from app.core.config import settings
from app.modules.ocr.providers.base import OcrProvider
from app.modules.ocr.providers.easyocr import EasyOcrProvider
from app.modules.ocr.providers.granite import GraniteProvider
from app.modules.ocr.providers.rapidocr import RapidOcrProvider

_PROVIDERS: dict[str, type[OcrProvider]] = {
    "rapidocr": RapidOcrProvider,
    "easyocr": EasyOcrProvider,
    "granite": GraniteProvider,
}


def get_ocr_provider(provider_name: str | None = None) -> OcrProvider:
    """Return an instantiated OCR provider by name.

    Falls back to settings.OCR_DEFAULT_PROVIDER if name is None.
    """
    name = provider_name or settings.OCR_DEFAULT_PROVIDER
    provider_cls = _PROVIDERS.get(name)
    if provider_cls is None:
        raise HTTPException(
            status_code=400,
            detail=f"Unknown OCR provider: {name}. Available: {list(_PROVIDERS.keys())}",
        )
    return provider_cls()


def list_available_providers() -> list[str]:
    """Return all registered provider names."""
    return list(_PROVIDERS.keys())
