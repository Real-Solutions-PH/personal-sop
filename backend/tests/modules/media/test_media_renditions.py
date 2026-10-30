"""A photo's preview rendition and inline placeholder: only the caller's own
finished image can be a preview, the placeholder is a small JPEG data URI,
and deleting a photo deletes its preview."""

import uuid
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.core.config import settings
from app.modules.iam.users.models import User
from app.modules.media import storage
from app.modules.media.models import MediaObject
from tests.utils.mobile import signed_in

API = f"{settings.API_V1_STR}/media"
LQIP = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ=="


@pytest.fixture(autouse=True)
def no_bucket(monkeypatch: pytest.MonkeyPatch) -> None:
    """A ticket presigns an upload URL; no object store is needed for that."""
    monkeypatch.setattr(storage, "presign_put", lambda *a, **k: "https://store/put")


def _media(
    db: Session, owner: User, *, kind: str = "image", state: str = "ready"
) -> MediaObject:
    m = MediaObject(
        owner_id=owner.id,
        tenant_id=owner.tenant_id,
        kind=kind,
        storage_key=f"u/{owner.id}/{uuid.uuid4()}",
        mime="video/mp4" if kind == "video" else "image/jpeg",
        size_bytes=10,
        state=state,
    )
    db.add(m)
    db.commit()
    db.refresh(m)
    return m


def _ticket(client: TestClient, h: dict[str, str], **extra: Any) -> Any:
    body = {"kind": "image", "mime": "image/jpeg", "size_bytes": 100, **extra}
    return client.post(f"{API}/uploads", headers=h, json=body)


def _code(r: Any) -> str:
    body = r.json()
    return str(body.get("detail", body).get("code"))


def _rows(db: Session, owner: User) -> int:
    db.expire_all()
    return len(
        db.exec(select(MediaObject).where(MediaObject.owner_id == owner.id)).all()
    )


def test_a_ticket_with_my_ready_preview_is_stored_and_echoed(
    client: TestClient, db: Session
) -> None:
    me, h = signed_in(db)
    preview = _media(db, me)
    r = _ticket(
        client, h, preview_id=str(preview.id), lqip=LQIP, width=2048, height=1536
    )
    assert r.status_code == 200, r.text
    db.expire_all()
    row = db.get(MediaObject, uuid.UUID(r.json()["id"]))
    assert row is not None
    assert (row.preview_id, row.lqip) == (preview.id, LQIP)
    # Once ready, reading it carries the preview's URL.
    row.state = "ready"
    db.add(row)
    db.commit()
    got = client.get(f"{API}/{row.id}", headers=h).json()
    assert got["preview_id"] == str(preview.id) and got["lqip"] == LQIP
    assert got["preview_url"] and preview.storage_key in got["preview_url"]


def test_someone_elses_or_a_missing_preview_is_404_and_creates_nothing(
    client: TestClient, db: Session
) -> None:
    other, _ = signed_in(db)
    theirs = _media(db, other)
    me, h = signed_in(db)
    for pid in (theirs.id, uuid.uuid4()):
        r = _ticket(client, h, preview_id=str(pid))
        assert r.status_code == 404, r.text
    assert _rows(db, me) == 0


def test_an_unfinished_or_video_preview_is_refused(
    client: TestClient, db: Session
) -> None:
    me, h = signed_in(db)
    for bad in (_media(db, me, state="pending"), _media(db, me, kind="video")):
        r = _ticket(client, h, preview_id=str(bad.id))
        assert (r.status_code, _code(r)) == (422, "media_preview_invalid")


def test_a_preview_or_placeholder_on_a_video_is_refused(
    client: TestClient, db: Session
) -> None:
    me, h = signed_in(db)
    preview = _media(db, me)
    for extra in ({"preview_id": str(preview.id)}, {"lqip": LQIP}):
        r = _ticket(client, h, kind="video", mime="video/mp4", **extra)
        assert (r.status_code, _code(r)) == (422, "media_preview_invalid")


def test_a_malformed_or_oversized_placeholder_is_refused(
    client: TestClient, db: Session
) -> None:
    _, h = signed_in(db)
    for lqip in (
        "https://evil.test/x.jpg",
        "data:image/png;base64,AAAA",
        "data:image/jpeg;base64," + "A" * 2048,
    ):
        assert _ticket(client, h, lqip=lqip).status_code == 422


def test_deleting_a_photo_deletes_its_preview(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    gone: list[str] = []
    monkeypatch.setattr(storage, "delete", lambda key: gone.append(key))
    me, h = signed_in(db)
    preview = _media(db, me)
    full = _media(db, me)
    full.preview_id = preview.id
    db.add(full)
    db.commit()
    assert client.delete(f"{API}/{full.id}", headers=h).status_code == 200
    assert set(gone) == {full.storage_key, preview.storage_key}
    db.expire_all()
    p = db.get(MediaObject, preview.id)
    assert p is not None and p.deleted_at is not None
