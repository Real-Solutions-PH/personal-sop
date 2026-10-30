"""Feed photos carry their preview, placeholder and size, and a page reads
its media in a fixed number of queries however many photos it holds."""

import uuid
from collections.abc import Iterator
from contextlib import contextmanager
from typing import Any

from fastapi.testclient import TestClient
from sqlalchemy import event
from sqlmodel import Session

from app.core.db import engine
from app.modules.iam.users.models import User
from app.modules.media.models import MediaObject
from tests.modules.social.api.conftest import Person, Trio
from tests.modules.social.api.helpers import API, ok

LQIP = "data:image/jpeg;base64,/9j/4AAQ"


def _photo(db: Session, who: Person, *, preview: bool = True) -> MediaObject:
    user = db.get(User, who.id)
    assert user is not None

    def row(**kw: Any) -> MediaObject:
        m = MediaObject(
            owner_id=who.id,
            tenant_id=user.tenant_id,
            kind="image",
            storage_key=f"u/{who.id}/{uuid.uuid4()}",
            mime="image/jpeg",
            size_bytes=10,
            state="ready",
            **kw,
        )
        db.add(m)
        db.commit()
        db.refresh(m)
        return m

    small = row(width=640, height=480) if preview else None
    return row(
        width=2048,
        height=1536,
        preview_id=small.id if small else None,
        lqip=LQIP if small else None,
    )


@contextmanager
def media_queries() -> Iterator[list[str]]:
    seen: list[str] = []

    def listen(*args: Any) -> None:
        sql = str(args[2])
        if "FROM media_object" in sql:
            seen.append(sql)

    event.listen(engine, "before_cursor_execute", listen)
    try:
        yield seen
    finally:
        event.remove(engine, "before_cursor_execute", listen)


def _post(client: TestClient, who: Person, photos: list[MediaObject]) -> Any:
    return ok(
        client.post(
            f"{API}/posts",
            headers=who.headers,
            json={
                "caption": "pics",
                "media": [{"media_id": str(m.id), "kind": "image"} for m in photos],
            },
        )
    )


def test_feed_photos_carry_preview_placeholder_and_size(
    client: TestClient, db: Session, trio: Trio
) -> None:
    new = _photo(db, trio.ana)
    old = _photo(db, trio.ana, preview=False)
    _post(client, trio.ana, [new, old])
    feed = ok(client.get(f"{API}/feed?tab=following", headers=trio.ben.headers))
    media = feed["data"][0]["media"]
    assert media[0]["url"] and media[0]["preview_url"]
    assert (media[0]["lqip"], media[0]["width"], media[0]["height"]) == (
        LQIP,
        2048,
        1536,
    )
    # An upload made before previews existed: the full image only.
    assert media[1]["url"] and media[1]["preview_url"] is None
    assert media[1]["lqip"] is None


def test_a_page_reads_its_media_in_a_fixed_number_of_queries(
    client: TestClient, db: Session, trio: Trio
) -> None:
    _post(client, trio.ana, [_photo(db, trio.ana)])
    with media_queries() as one:
        ok(client.get(f"{API}/feed?tab=following", headers=trio.ben.headers))
    _post(client, trio.ana, [_photo(db, trio.ana) for _ in range(3)])
    _post(client, trio.ana, [_photo(db, trio.ana) for _ in range(2)])
    with media_queries() as six:
        ok(client.get(f"{API}/feed?tab=following", headers=trio.ben.headers))
    assert len(one) <= 2 and len(six) == len(one)
