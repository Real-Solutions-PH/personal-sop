"""Startup must not hard-fail when object storage is unreachable.

Only OCR uses object storage, so with OCR disabled the bucket is never
touched, and with OCR enabled an unreachable MinIO degrades OCR rather than
refusing to boot.
"""

import pytest
from fastapi.testclient import TestClient

import app.main as main_module
from app.main import app


def _boom(*_args: object, **_kwargs: object) -> None:
    raise ConnectionError("MinIO unreachable")


def test_boot_succeeds_when_ocr_disabled_and_storage_down(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(main_module.settings, "OCR_ENABLED", False)
    monkeypatch.setattr(main_module, "ensure_bucket", _boom)
    # Entering the context runs the lifespan; it must not raise.
    with TestClient(app):
        pass


def test_boot_succeeds_when_ocr_enabled_but_storage_down(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(main_module.settings, "OCR_ENABLED", True)
    monkeypatch.setattr(main_module, "ensure_bucket", _boom)
    with TestClient(app):
        pass


def test_ocr_bucket_ensured_when_ocr_enabled(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls: list[str] = []
    monkeypatch.setattr(main_module.settings, "OCR_ENABLED", True)
    monkeypatch.setattr(
        main_module, "ensure_bucket", lambda bucket: calls.append(bucket)
    )
    with TestClient(app):
        pass
    assert calls == [main_module.settings.OCR_BUCKET]


def test_default_bucket_never_ensured(monkeypatch: pytest.MonkeyPatch) -> None:
    # Nothing uses the default bucket, so boot must not touch it.
    calls: list[str] = []
    monkeypatch.setattr(main_module.settings, "OCR_ENABLED", False)
    monkeypatch.setattr(
        main_module, "ensure_bucket", lambda bucket: calls.append(bucket)
    )
    with TestClient(app):
        pass
    assert calls == []
