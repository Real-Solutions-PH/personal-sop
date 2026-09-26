"""OCR document flows: upload/list/get/delete via the routes.

The OCR provider and the MinIO storage client are faked at the service
seam (get_ocr_provider / MinioEngine.get_instance), so these tests
exercise the full HTTP -> services -> repo stack without docling or a
real object store. Cross-tenant invisibility (404) is already covered by
test_tenant_scoping.py; the same-tenant wrong-owner 403 lives here.
"""

import uuid
from collections.abc import Generator

import pytest
from fastapi import FastAPI, HTTPException, status
from fastapi.testclient import TestClient
from sqlmodel import Session

from app.core.config import settings
from app.modules.ocr import services as ocr_services
from app.modules.ocr.main import router as ocr_router
from app.modules.ocr.providers.base import OcrProvider, OcrResult
from app.shared.errors import register_exception_handlers
from tests.utils.user import create_auth_user, user_authentication_headers

OCR = f"{settings.API_V1_STR}/ocr"

PNG_FILE = ("scan.png", b"fake-png-bytes", "image/png")


class FakeMinio:
    """Records uploads/deletes; optionally fails on delete."""

    def __init__(self, *, fail_delete: bool = False) -> None:
        self.uploads: list[str] = []
        self.deletes: list[str] = []
        self.fail_delete = fail_delete

    def upload_file(
        self, *, bucket: str, key: str, data: bytes, content_type: str
    ) -> None:
        assert bucket == settings.OCR_BUCKET
        assert data
        assert content_type
        self.uploads.append(key)

    def delete_file(self, *, bucket: str, key: str) -> None:
        if self.fail_delete:
            raise RuntimeError("minio down")
        assert bucket == settings.OCR_BUCKET
        self.deletes.append(key)


class FakeProvider(OcrProvider):
    def __init__(self, *, fail: bool = False) -> None:
        self._fail = fail

    def name(self) -> str:
        return "fake"

    async def extract(self, file_bytes: bytes, mime_type: str) -> OcrResult:
        if self._fail:
            raise RuntimeError("ocr blew up")
        return OcrResult(
            raw_text="hello",
            markdown_text="# hello",
            page_count=2,
            provider_name="fake",
        )


@pytest.fixture(scope="module")
def aux_client() -> Generator[TestClient, None, None]:
    aux_app = FastAPI()
    register_exception_handlers(aux_app)
    aux_app.include_router(ocr_router, prefix=settings.API_V1_STR)
    with TestClient(aux_app) as c:
        yield c


@pytest.fixture
def fake_minio(monkeypatch: pytest.MonkeyPatch) -> FakeMinio:
    minio = FakeMinio()
    monkeypatch.setattr(
        "app.modules.ocr.services.MinioEngine.get_instance",
        classmethod(lambda _cls: minio),
    )
    return minio


@pytest.fixture
def fake_provider(monkeypatch: pytest.MonkeyPatch) -> FakeProvider:
    provider = FakeProvider()
    monkeypatch.setattr(ocr_services, "get_ocr_provider", lambda _name=None: provider)
    return provider


def _upload(client: TestClient, headers: dict[str, str]) -> dict[str, object]:
    r = client.post(f"{OCR}/upload", headers=headers, files={"file": PNG_FILE})
    assert r.status_code == status.HTTP_200_OK
    data: dict[str, object] = r.json()
    return data


@pytest.mark.usefixtures("fake_provider")
def test_upload_success_persists_completed_doc(
    aux_client: TestClient,
    normal_user_token_headers: dict[str, str],
    fake_minio: FakeMinio,
) -> None:
    doc = _upload(aux_client, normal_user_token_headers)
    assert doc["status"] == "completed"
    assert doc["extracted_text"] == "# hello"
    assert doc["provider_used"] == "fake"
    assert doc["page_count"] == 2
    assert doc["original_filename"] == "scan.png"
    # minio_key is internal and never surfaced in the API response.
    assert "minio_key" not in doc
    assert len(fake_minio.uploads) == 1
    assert fake_minio.uploads[0].endswith(".png")

    # detail route returns the same document for its owner
    r = aux_client.get(f"{OCR}/{doc['id']}", headers=normal_user_token_headers)
    assert r.status_code == status.HTTP_200_OK
    assert r.json()["id"] == doc["id"]


@pytest.mark.usefixtures("fake_minio")
def test_upload_provider_failure_marks_doc_failed(
    aux_client: TestClient,
    normal_user_token_headers: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    provider = FakeProvider(fail=True)
    monkeypatch.setattr(ocr_services, "get_ocr_provider", lambda _name=None: provider)
    doc = _upload(aux_client, normal_user_token_headers)
    assert doc["status"] == "failed"
    # Client sees a generic message; the raw exception text is never leaked.
    assert doc["error_message"] == "OCR processing failed."
    assert "ocr blew up" not in str(doc["error_message"])


def test_upload_rejects_disallowed_mime_type(
    aux_client: TestClient, normal_user_token_headers: dict[str, str]
) -> None:
    r = aux_client.post(
        f"{OCR}/upload",
        headers=normal_user_token_headers,
        files={"file": ("x.zip", b"zzz", "application/zip")},
    )
    assert r.status_code == status.HTTP_400_BAD_REQUEST


def test_upload_rejects_oversize_file(
    aux_client: TestClient,
    normal_user_token_headers: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "OCR_MAX_FILE_SIZE_MB", 0)
    r = aux_client.post(
        f"{OCR}/upload",
        headers=normal_user_token_headers,
        files={"file": PNG_FILE},
    )
    assert r.status_code == status.HTTP_400_BAD_REQUEST


class _StreamUpload:
    """Minimal UploadFile stand-in with no declared size (chunked upload)."""

    def __init__(self, data: bytes, chunk: int) -> None:
        self._data = data
        self._chunk = chunk
        self._pos = 0
        self.size: int | None = None

    async def read(self, size: int = -1) -> bytes:
        take = self._chunk if size < 0 else min(size, self._chunk)
        out = self._data[self._pos : self._pos + take]
        self._pos += len(out)
        return out


def test_read_capped_rejects_body_over_limit_without_declared_size() -> None:
    import asyncio

    upload = _StreamUpload(b"x" * 50, chunk=8)
    with pytest.raises(HTTPException) as exc:
        asyncio.run(ocr_services._read_capped(upload, max_bytes=16))  # type: ignore[arg-type]
    assert exc.value.status_code == 400


def test_read_capped_returns_body_under_limit() -> None:
    import asyncio

    upload = _StreamUpload(b"x" * 10, chunk=8)
    data = asyncio.run(ocr_services._read_capped(upload, max_bytes=16))  # type: ignore[arg-type]
    assert data == b"x" * 10


def test_get_extension_fallbacks() -> None:
    assert ocr_services._get_extension("a.PDF", "application/pdf") == ".pdf"
    assert ocr_services._get_extension("noext", "image/jpeg") == ".jpg"
    assert ocr_services._get_extension("noext", "application/unknown") == ""


@pytest.mark.usefixtures("fake_minio", "fake_provider")
def test_list_supports_status_filter_and_pagination(
    aux_client: TestClient,
    normal_user_token_headers: dict[str, str],
) -> None:
    _upload(aux_client, normal_user_token_headers)
    _upload(aux_client, normal_user_token_headers)

    r = aux_client.get(
        f"{OCR}/", headers=normal_user_token_headers, params={"status": "completed"}
    )
    assert r.status_code == status.HTTP_200_OK
    assert r.json()["count"] >= 2
    assert all(d["status"] == "completed" for d in r.json()["data"])

    r = aux_client.get(
        f"{OCR}/", headers=normal_user_token_headers, params={"limit": 1}
    )
    assert len(r.json()["data"]) == 1

    r = aux_client.get(
        f"{OCR}/", headers=normal_user_token_headers, params={"status": "failed"}
    )
    ids = {d["id"] for d in r.json()["data"]}
    assert all(d["status"] == "failed" for d in r.json()["data"]) or ids == set()


def test_get_missing_doc_is_404(
    aux_client: TestClient, normal_user_token_headers: dict[str, str]
) -> None:
    r = aux_client.get(f"{OCR}/{uuid.uuid4()}", headers=normal_user_token_headers)
    assert r.status_code == status.HTTP_404_NOT_FOUND


@pytest.mark.usefixtures("fake_minio", "fake_provider")
def test_same_tenant_wrong_owner_is_403(
    aux_client: TestClient,
    db: Session,
    normal_user_token_headers: dict[str, str],
) -> None:
    doc = _upload(aux_client, normal_user_token_headers)

    # second user in the same (default) tenant: row visible, access denied
    other, password = create_auth_user(db)
    other_headers = user_authentication_headers(email=other.email, password=password)
    r = aux_client.get(f"{OCR}/{doc['id']}", headers=other_headers)
    assert r.status_code == status.HTTP_403_FORBIDDEN


@pytest.mark.usefixtures("fake_minio", "fake_provider")
def test_superuser_sees_and_reads_other_users_docs(
    aux_client: TestClient,
    normal_user_token_headers: dict[str, str],
    superuser_token_headers: dict[str, str],
) -> None:
    doc = _upload(aux_client, normal_user_token_headers)

    r = aux_client.get(f"{OCR}/", headers=superuser_token_headers)
    assert r.status_code == status.HTTP_200_OK
    assert any(d["id"] == doc["id"] for d in r.json()["data"])

    r = aux_client.get(f"{OCR}/{doc['id']}", headers=superuser_token_headers)
    assert r.status_code == status.HTTP_200_OK


@pytest.mark.usefixtures("fake_provider")
def test_delete_removes_row_and_storage_object(
    aux_client: TestClient,
    normal_user_token_headers: dict[str, str],
    fake_minio: FakeMinio,
) -> None:
    doc = _upload(aux_client, normal_user_token_headers)
    r = aux_client.delete(f"{OCR}/{doc['id']}", headers=normal_user_token_headers)
    assert r.status_code == status.HTTP_200_OK
    assert len(fake_minio.deletes) == 1
    assert fake_minio.deletes[0] == fake_minio.uploads[0]

    r = aux_client.get(f"{OCR}/{doc['id']}", headers=normal_user_token_headers)
    assert r.status_code == status.HTTP_404_NOT_FOUND


@pytest.mark.usefixtures("fake_provider")
def test_delete_survives_storage_failure(
    aux_client: TestClient,
    normal_user_token_headers: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    minio = FakeMinio(fail_delete=True)
    monkeypatch.setattr(
        "app.modules.ocr.services.MinioEngine.get_instance",
        classmethod(lambda _cls: minio),
    )
    doc = _upload(aux_client, normal_user_token_headers)

    r = aux_client.delete(f"{OCR}/{doc['id']}", headers=normal_user_token_headers)
    assert r.status_code == status.HTTP_200_OK  # storage failure is swallowed

    r = aux_client.get(f"{OCR}/{doc['id']}", headers=normal_user_token_headers)
    assert r.status_code == status.HTTP_404_NOT_FOUND


def test_providers_route_lists_registry(
    aux_client: TestClient, normal_user_token_headers: dict[str, str]
) -> None:
    r = aux_client.get(f"{OCR}/providers", headers=normal_user_token_headers)
    assert r.status_code == status.HTTP_200_OK
    assert set(r.json()) == {"rapidocr", "easyocr", "granite"}
