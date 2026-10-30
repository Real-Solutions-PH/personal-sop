"""A profile photo must be the person's own finished image, and a profile
that points at someone else's upload never gets a URL for it."""

import uuid
from typing import Any

from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.core.config import settings
from app.modules.iam.users.models import User
from app.modules.media.models import MediaObject
from app.modules.profile.models import UserProfile
from tests.modules.social.api.conftest import Person, Trio
from tests.modules.social.api.helpers import API, code, ok

PROFILE = f"{settings.API_V1_STR}/profile"


def _media(
    db: Session, who: Person, *, kind: str = "image", state: str = "ready"
) -> MediaObject:
    user = db.get(User, who.id)
    assert user is not None
    media = MediaObject(
        owner_id=who.id,
        tenant_id=user.tenant_id,
        kind=kind,
        storage_key=f"u/{who.id}/{uuid.uuid4()}",
        mime="video/mp4" if kind == "video" else "image/jpeg",
        size_bytes=10,
        state=state,
    )
    db.add(media)
    db.commit()
    db.refresh(media)
    return media


def _set(client: TestClient, who: Person, media_id: uuid.UUID | None) -> Any:
    return client.patch(
        PROFILE,
        headers=who.headers,
        json={"photo_media_id": str(media_id) if media_id else None},
    )


def _stored(db: Session, who: Person) -> uuid.UUID | None:
    db.expire_all()
    prof = db.exec(select(UserProfile).where(UserProfile.owner_id == who.id)).one()
    return prof.photo_media_id


def _photo_url(client: TestClient, viewer: Person, of: Person) -> str | None:
    person = ok(client.get(f"{API}/people/{of.id}", headers=viewer.headers))
    url = person["photo_url"]
    assert url is None or isinstance(url, str)
    return url


def test_my_own_ready_image_becomes_my_photo(
    client: TestClient, db: Session, trio: Trio
) -> None:
    photo = _media(db, trio.ana)
    ok(_set(client, trio.ana, photo.id))
    me = ok(client.get(f"{API}/me", headers=trio.ana.headers))
    assert me["photo_url"] and photo.storage_key in me["photo_url"]


def test_another_persons_upload_is_refused_and_the_profile_is_unchanged(
    client: TestClient, db: Session, trio: Trio
) -> None:
    mine = _media(db, trio.ben)
    ok(_set(client, trio.ben, mine.id))
    theirs = _media(db, trio.ana)
    r = _set(client, trio.ben, theirs.id)
    assert r.status_code == 404, r.text
    assert _stored(db, trio.ben) == mine.id


def test_an_unfinished_upload_or_a_video_is_refused(
    client: TestClient, db: Session, trio: Trio
) -> None:
    pending = _media(db, trio.ana, state="pending")
    r = _set(client, trio.ana, pending.id)
    assert (r.status_code, code(r)) == (422, "media_not_ready")
    video = _media(db, trio.ana, kind="video")
    r = _set(client, trio.ana, video.id)
    assert (r.status_code, code(r)) == (422, "media_wrong_kind")
    assert _stored(db, trio.ana) is None


def test_null_clears_the_photo_for_everyone(
    client: TestClient, db: Session, trio: Trio
) -> None:
    photo = _media(db, trio.ana)
    ok(_set(client, trio.ana, photo.id))
    assert _photo_url(client, trio.ben, trio.ana)
    ok(_set(client, trio.ana, None))
    assert _stored(db, trio.ana) is None
    assert _photo_url(client, trio.ben, trio.ana) is None


def _point_at(db: Session, who: Person, media_id: uuid.UUID) -> None:
    """A row written before the ownership check existed."""
    prof = db.exec(select(UserProfile).where(UserProfile.owner_id == who.id)).one()
    prof.photo_media_id = media_id
    db.add(prof)
    db.commit()


def test_a_stored_photo_owned_by_someone_else_gets_no_url(
    client: TestClient, db: Session, trio: Trio
) -> None:
    victims = _media(db, trio.ana)
    _point_at(db, trio.cy, victims.id)
    own = _media(db, trio.ben)
    ok(_set(client, trio.ben, own.id))
    for viewer in (trio.cy, trio.ben):
        assert _photo_url(client, viewer, trio.cy) is None
    me = ok(client.get(f"{API}/me", headers=trio.cy.headers))
    assert me["photo_url"] is None
    # A profile pointing at its own photo still gets one.
    assert _photo_url(client, trio.cy, trio.ben)
    # The stored row is left as it was.
    assert _stored(db, trio.cy) == victims.id


def test_two_profiles_on_one_photo_only_the_owner_gets_the_url(
    client: TestClient, db: Session, trio: Trio
) -> None:
    photo = _media(db, trio.ana)
    ok(_set(client, trio.ana, photo.id))
    _point_at(db, trio.cy, photo.id)
    for viewer in (trio.ben, trio.cy):
        assert _photo_url(client, viewer, trio.ana)
        assert _photo_url(client, viewer, trio.cy) is None
