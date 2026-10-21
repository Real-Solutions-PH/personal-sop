import uuid

import httpx
import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session

from app.core.config import settings
from app.modules.media import public
from tests.modules.media.test_sniff import JPEG, PDF
from tests.utils.mobile import ctx_for, signed_in

API = f"{settings.API_V1_STR}/media"


def _upload(
    client: TestClient, h: dict[str, str], *, kind: str, mime: str, data: bytes
) -> dict[str, object]:
    t = client.post(
        f"{API}/uploads",
        headers=h,
        json={"kind": kind, "mime": mime, "size_bytes": len(data)},
    )
    assert t.status_code == 200, t.text
    ticket = t.json()
    put = httpx.put(str(ticket["upload_url"]), content=data, headers=ticket["headers"])
    assert put.status_code == 200, put.text
    done = client.post(f"{API}/{ticket['id']}/complete", headers=h)
    assert done.status_code == 200, done.text
    return dict(done.json())


def test_upload_complete_read_delete(client: TestClient, db: Session) -> None:
    user, h = signed_in(db)
    m = _upload(client, h, kind="image", mime="image/jpeg", data=JPEG)
    assert m["state"] == "ready" and m["mime"] == "image/jpeg"
    got = httpx.get(str(m["url"]))
    assert got.status_code == 200 and got.content == JPEG
    # completing twice returns the same verdict
    again = client.post(f"{API}/{m['id']}/complete", headers=h).json()
    assert again["state"] == "ready"
    with ctx_for(user) as ctx:
        media = public.require_ready(ctx, uuid.UUID(str(m["id"])))
        assert public.read_bytes(media) == JPEG
        with pytest.raises(Exception) as wrong:
            public.require_ready(ctx, media.id, kinds=("audio",))
        assert getattr(wrong.value, "status_code", None) == 422
    assert client.delete(f"{API}/{m['id']}", headers=h).status_code == 200
    assert client.get(f"{API}/{m['id']}", headers=h).status_code == 404


def test_bytes_that_lie_are_rejected_and_removed(
    client: TestClient, db: Session
) -> None:
    _, h = signed_in(db)
    m = _upload(client, h, kind="image", mime="image/jpeg", data=b"not an image at all")
    assert m["state"] == "rejected" and m.get("url") is None
    # a PDF is a fine "file" but not an "image"
    pdf_as_image = _upload(client, h, kind="image", mime="image/png", data=PDF)
    assert pdf_as_image["state"] == "rejected"
    assert (
        _upload(client, h, kind="file", mime="application/pdf", data=PDF)["state"]
        == "ready"
    )


def test_request_refusals(client: TestClient, db: Session) -> None:
    _, h = signed_in(db)
    too_big = client.post(
        f"{API}/uploads",
        headers=h,
        json={"kind": "image", "mime": "image/jpeg", "size_bytes": 10**9},
    )
    assert too_big.status_code == 422 and too_big.json()["code"] == "media_too_large"
    bad_type = client.post(
        f"{API}/uploads",
        headers=h,
        json={"kind": "image", "mime": "application/x-sh", "size_bytes": 10},
    )
    assert bad_type.json()["code"] == "media_type_not_allowed"
    t = client.post(
        f"{API}/uploads",
        headers=h,
        json={"kind": "image", "mime": "image/jpeg", "size_bytes": 10},
    ).json()
    early = client.post(f"{API}/{t['id']}/complete", headers=h)
    assert early.status_code == 422 and early.json()["code"] == "media_not_uploaded"


def test_another_users_media_is_invisible(client: TestClient, db: Session) -> None:
    alice, ha = signed_in(db)
    bob, hb = signed_in(db)
    m = _upload(client, ha, kind="image", mime="image/jpeg", data=JPEG)
    assert client.get(f"{API}/{m['id']}", headers=hb).status_code == 404
    assert client.delete(f"{API}/{m['id']}", headers=hb).status_code == 404
    assert client.post(f"{API}/{m['id']}/complete", headers=hb).status_code == 404
    with ctx_for(bob) as ctx:
        with pytest.raises(Exception) as exc:
            public.require_ready(ctx, uuid.UUID(str(m["id"])))
        assert getattr(exc.value, "status_code", None) == 404
        # same tenant: a visible URL can be issued once the caller checked visibility
        assert public.visible_download_url(ctx, uuid.UUID(str(m["id"]))).startswith(
            "http"
        )
    del alice
