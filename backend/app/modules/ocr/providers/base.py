from abc import ABC, abstractmethod
from dataclasses import dataclass


@dataclass
class OcrResult:
    """Standardized result from any OCR provider."""

    raw_text: str
    markdown_text: str
    page_count: int
    provider_name: str


class OcrProvider(ABC):
    """Abstract base for all OCR provider implementations."""

    @abstractmethod
    async def extract(self, file_bytes: bytes, mime_type: str) -> OcrResult:
        """Run OCR on the given file bytes and return structured results."""
        ...

    @abstractmethod
    def name(self) -> str:
        """Return provider identifier."""
        ...
