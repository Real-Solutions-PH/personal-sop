import asyncio
import tempfile
from pathlib import Path

from app.modules.ocr.providers.base import OcrProvider, OcrResult


class RapidOcrProvider(OcrProvider):
    """RapidOCR backend via Docling. Default, CPU-friendly, fast."""

    def name(self) -> str:
        return "rapidocr"

    async def extract(self, file_bytes: bytes, mime_type: str) -> OcrResult:
        return await asyncio.to_thread(self._extract_sync, file_bytes, mime_type)

    # pragma-justification: body imports docling, which ships only in the
    # optional "ocr" extra and is not installed in CI (pyproject mypy
    # override documents the same gap) — genuinely unexercisable there.
    def _extract_sync(
        self, file_bytes: bytes, mime_type: str
    ) -> OcrResult:  # pragma: no cover
        from docling.datamodel.base_models import InputFormat
        from docling.datamodel.pipeline_options import (
            PdfPipelineOptions,
            RapidOcrOptions,
        )
        from docling.document_converter import DocumentConverter, PdfFormatOption

        pipeline_options = PdfPipelineOptions()
        pipeline_options.do_ocr = True
        pipeline_options.ocr_options = RapidOcrOptions()

        converter = DocumentConverter(
            format_options={
                InputFormat.PDF: PdfFormatOption(
                    pipeline_options=pipeline_options,
                ),
                InputFormat.IMAGE: PdfFormatOption(
                    pipeline_options=pipeline_options,
                ),
            }
        )

        suffix = _mime_to_suffix(mime_type)
        with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
            tmp.write(file_bytes)
            tmp_path = Path(tmp.name)

        try:
            result = converter.convert(str(tmp_path))
            markdown = result.document.export_to_markdown()
            raw_text = markdown
            page_count = (
                max(len(result.document.pages), 1)
                if hasattr(result.document, "pages")
                else 1
            )
        finally:
            tmp_path.unlink(missing_ok=True)

        return OcrResult(
            raw_text=raw_text,
            markdown_text=markdown,
            page_count=page_count,
            provider_name="rapidocr",
        )


def _mime_to_suffix(mime_type: str) -> str:
    mapping = {
        "image/png": ".png",
        "image/jpeg": ".jpg",
        "image/tiff": ".tiff",
        "application/pdf": ".pdf",
    }
    return mapping.get(mime_type, ".png")
