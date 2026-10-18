"""Stories (the close-friends gate, expiry, the tray) and notes."""

import uuid
from datetime import timedelta
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session

from app.modules.social.models import Note, Story
from tests.modules.social.api.conftest import Bus, Trio
from tests.modules.social.api.helpers import API, code, ok


def _story(client: TestClient, headers: dict[str, str], **kw: Any) -> dict[str, Any]:
    body = {"kind": "text", "text": "hello", "bg": ["#111111", "#222222"], **kw}
    return ok(client.post(f"{API}/stories", headers=headers, json=body))  # type: ignore[no-any-return]


def _tray_ids(client: TestClient, headers: dict[str, str]) -> dict[str, list[str]]:
    tray = ok(client.get(f"{API}/stories", headers=headers))
    return {g["person"]["id"]: [i["id"] for i in g["items"]] for g in tray["data"]}


def test_story_create_expires_in_24h(client: TestClient, trio: Trio) -> None:
    s = _story(client, trio.ana.headers)
    from datetime import datetime

    created = datetime.fromisoformat(s["created_at"])
    expires = datetime.fromisoformat(s["expires_at"])
    assert expires - created == timedelta(hours=24)
    assert s["seen"] and s["likes"] == 0  # own story: seen, like count shown


def test_story_payload_must_match_kind(client: TestClient, trio: Trio) -> None:
    h = trio.ana.headers
    assert (
        client.post(f"{API}/stories", headers=h, json={"kind": "text"}).status_code
        == 422
    )
    assert (
        client.post(f"{API}/stories", headers=h, json={"kind": "image"}).status_code
        == 422
    )
    assert (
        client.post(f"{API}/stories", headers=h, json={"kind": "progress"}).status_code
        == 422
    )


def test_everyone_story_visibility_matrix(client: TestClient, trio: Trio) -> None:
    s = _story(client, trio.ana.headers)
    assert (
        ok(client.get(f"{API}/stories/{s['id']}", headers=trio.ben.headers))["id"]
        == s["id"]
    )
    r = client.get(f"{API}/stories/{s['id']}", headers=trio.cy.headers)
    assert r.status_code == 404 and code(r) == "story_not_found"
    assert str(trio.ana.id) in _tray_ids(client, trio.ben.headers)
    assert str(trio.ana.id) not in _tray_ids(client, trio.cy.headers)
    # Every write on it is gated the same way.
    for verb, path in (("put", "seen"), ("put", "like"), ("delete", "like")):
        assert (
            getattr(client, verb)(
                f"{API}/stories/{s['id']}/{path}", headers=trio.cy.headers
            ).status_code
            == 404
        )


def test_close_friends_story_gate(client: TestClient, trio: Trio) -> None:
    ana, ben, cy = trio.ana, trio.ben, trio.cy
    # Cy is a close friend without following; Ben follows but is not one.
    ok(
        client.put(
            f"{API}/people/{cy.id}/close-friend",
            headers=ana.headers,
            json={"close_friend": True},
        )
    )
    s = _story(client, ana.headers, audience="close")
    assert (
        ok(client.get(f"{API}/stories/{s['id']}", headers=cy.headers))["audience"]
        == "close"
    )
    assert (
        client.get(f"{API}/stories/{s['id']}", headers=ben.headers).status_code == 404
    )
    assert str(ana.id) not in _tray_ids(client, ben.headers)
    tray = ok(client.get(f"{API}/stories", headers=cy.headers))
    group = next(g for g in tray["data"] if g["person"]["id"] == str(ana.id))
    assert group["close"] and group["items"][0]["id"] == s["id"]
    # Dropping Cy from the list closes the gate again.
    ok(
        client.put(
            f"{API}/people/{cy.id}/close-friend",
            headers=ana.headers,
            json={"close_friend": False},
        )
    )
    assert client.get(f"{API}/stories/{s['id']}", headers=cy.headers).status_code == 404


def test_expired_story_is_never_returned(
    client: TestClient, trio: Trio, db: Session
) -> None:
    s = _story(client, trio.ana.headers)
    row = db.get(Story, uuid.UUID(s["id"]))
    assert row is not None
    row.expires_at = row.created_at - timedelta(seconds=1)
    db.add(row)
    db.commit()
    for person in (trio.ana, trio.ben):
        assert (
            client.get(f"{API}/stories/{s['id']}", headers=person.headers).status_code
            == 404
        )
        assert s["id"] not in sum(_tray_ids(client, person.headers).values(), [])


def test_tray_order_seen_state_and_like(
    client: TestClient, trio: Trio, bus: Bus
) -> None:
    ana, ben, cy = trio.ana, trio.ben, trio.cy
    ok(client.put(f"{API}/people/{cy.id}/follow", headers=ben.headers))
    a1 = _story(client, ana.headers, text="a1")
    c1 = _story(client, cy.headers, text="c1")
    mine = _story(client, ben.headers, text="mine")
    tray = ok(client.get(f"{API}/stories", headers=ben.headers))
    # Me first, then unseen by recency (Cy posted after Ana).
    assert [g["person"]["id"] for g in tray["data"]] == [
        str(ben.id),
        str(cy.id),
        str(ana.id),
    ]
    assert tray["data"][0]["items"][0]["id"] == mine["id"]
    seen = ok(client.put(f"{API}/stories/{c1['id']}/seen", headers=ben.headers))
    assert seen["seen"] and seen["likes"] is None  # not the author: no count
    ok(client.put(f"{API}/stories/{c1['id']}/seen", headers=ben.headers))  # idempotent
    tray = ok(client.get(f"{API}/stories", headers=ben.headers))
    # Seen groups drop behind unseen ones.
    assert [g["person"]["id"] for g in tray["data"]] == [
        str(ben.id),
        str(ana.id),
        str(cy.id),
    ]
    assert [g["unseen"] for g in tray["data"]] == [False, True, False]
    bus.clear()
    liked = ok(client.put(f"{API}/stories/{a1['id']}/like", headers=ben.headers))
    assert liked["liked"]
    own = ok(client.get(f"{API}/stories/{a1['id']}", headers=ana.headers))
    assert own["likes"] == 1
    act = ok(client.get(f"{API}/activity", headers=ana.headers))["data"]
    assert [a["kind"] for a in act if a["kind"] == "story"] == ["story"]
    assert bus.types(ana) == ["social.activity"]
    ok(client.delete(f"{API}/stories/{a1['id']}/like", headers=ben.headers))
    assert (
        ok(client.get(f"{API}/stories/{a1['id']}", headers=ana.headers))["likes"] == 0
    )


def test_story_delete_is_author_only(client: TestClient, trio: Trio) -> None:
    s = _story(client, trio.ana.headers)
    assert (
        client.delete(f"{API}/stories/{s['id']}", headers=trio.ben.headers).status_code
        == 404
    )
    ok(client.delete(f"{API}/stories/{s['id']}", headers=trio.ana.headers), 204)
    assert (
        client.get(f"{API}/stories/{s['id']}", headers=trio.ben.headers).status_code
        == 404
    )


def test_story_events_reach_the_audience_only(
    client: TestClient, trio: Trio, bus: Bus
) -> None:
    ana, ben, cy = trio.ana, trio.ben, trio.cy
    _story(client, ana.headers)
    assert bus.types(ben) == ["social.story"] and bus.types(cy) == []
    bus.clear()
    ok(
        client.put(
            f"{API}/people/{cy.id}/close-friend",
            headers=ana.headers,
            json={"close_friend": True},
        )
    )
    _story(client, ana.headers, audience="close")
    assert bus.types(cy) == ["social.story"] and bus.types(ben) == []


@pytest.mark.xfail(
    raises=NotImplementedError,
    strict=False,
    reason="media.public.require_ready is a stub until merge",
)
def test_photo_story_needs_ready_media(client: TestClient, trio: Trio) -> None:
    r = client.post(
        f"{API}/stories",
        headers=trio.ana.headers,
        json={"kind": "image", "media_id": str(uuid.uuid4())},
    )
    assert r.status_code == 404


# ---------------------------------------------------------------- notes


def test_note_set_replace_clear_and_like(client: TestClient, trio: Trio) -> None:
    ana, ben, cy = trio.ana, trio.ben, trio.cy
    n = ok(
        client.put(f"{API}/notes/me", headers=ana.headers, json={"text": "leg day 🦵"})
    )
    assert (
        ok(client.get(f"{API}/notes", headers=ben.headers))["data"][0]["text"]
        == "leg day 🦵"
    )
    # Not a follower: no notes, and the like is a 404.
    assert ok(client.get(f"{API}/notes", headers=cy.headers))["count"] == 0
    assert (
        client.put(f"{API}/notes/{n['id']}/like", headers=cy.headers).status_code == 404
    )
    assert ok(client.put(f"{API}/notes/{n['id']}/like", headers=ben.headers))["liked"]
    # A new note replaces the old one (same row) and resets its likes.
    n2 = ok(
        client.put(f"{API}/notes/me", headers=ana.headers, json={"text": "rest day"})
    )
    assert n2["id"] == n["id"]
    as_ben = ok(client.get(f"{API}/notes", headers=ben.headers))["data"]
    assert [(x["text"], x["liked"]) for x in as_ben] == [("rest day", False)]
    # Mine comes first in my own list.
    ok(client.put(f"{API}/notes/me", headers=ben.headers, json={"text": "me"}))
    assert [
        x["person"]["id"]
        for x in ok(client.get(f"{API}/notes", headers=ben.headers))["data"]
    ] == [
        str(ben.id),
        str(ana.id),
    ]
    ok(client.delete(f"{API}/notes/me", headers=ana.headers), 204)
    assert [
        x["person"]["id"]
        for x in ok(client.get(f"{API}/notes", headers=ben.headers))["data"]
    ] == [str(ben.id)]
    assert (
        client.put(
            f"{API}/notes/me", headers=ana.headers, json={"text": "x" * 61}
        ).status_code
        == 422
    )


def test_expired_note_is_hidden(client: TestClient, trio: Trio, db: Session) -> None:
    n = ok(
        client.put(f"{API}/notes/me", headers=trio.ana.headers, json={"text": "brb"})
    )
    row = db.get(Note, uuid.UUID(n["id"]))
    assert row is not None
    row.expires_at = row.created_at - timedelta(seconds=1)
    db.add(row)
    db.commit()
    assert ok(client.get(f"{API}/notes", headers=trio.ben.headers))["count"] == 0
    assert (
        client.put(f"{API}/notes/{n['id']}/like", headers=trio.ben.headers).status_code
        == 404
    )
