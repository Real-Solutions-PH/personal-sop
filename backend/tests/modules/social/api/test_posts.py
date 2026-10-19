"""Posts, the two feeds, likes, saves, comments and tag search."""

import uuid
from datetime import timedelta
from typing import Any

from fastapi.testclient import TestClient
from sqlmodel import Session

from app.modules.social.models import Post
from tests.modules.social.api.conftest import Bus, Trio
from tests.modules.social.api.helpers import API, code, ok


def _post(
    client: TestClient, headers: dict[str, str], caption: str = "hi", **kw: Any
) -> dict[str, Any]:
    post: dict[str, Any] = ok(
        client.post(f"{API}/posts", headers=headers, json={"caption": caption, **kw})
    )
    return post


PROGRESS = {
    "accent": "fit",
    "kind": "Workout",
    "title": "Lower A",
    "stats": [{"label": "Top set", "value": "140", "unit": "kg"}],
}


def test_create_post_parses_tags_and_keeps_progress(
    client: TestClient, trio: Trio
) -> None:
    pid = str(uuid.uuid4())
    p = _post(
        client,
        trio.ana.headers,
        "New squat PR 🎉 #LegDay #progress #legday",
        id=pid,
        progress=PROGRESS,
        location="BGC",
    )
    assert p["id"] == pid and p["tags"] == ["legday", "progress"]
    assert p["progress"]["title"] == "Lower A" and p["location"] == "BGC"
    assert (p["likes"], p["liked"], p["saved"], p["comments"]) == (0, False, False, 0)
    assert p["author"]["id"] == str(trio.ana.id)
    # Replaying the create returns the same post.
    assert _post(client, trio.ana.headers, "other", id=pid)["caption"].startswith(
        "New squat"
    )


def test_post_needs_content(client: TestClient, trio: Trio) -> None:
    r = client.post(f"{API}/posts", headers=trio.ana.headers, json={"caption": "  "})
    assert r.status_code == 422


def test_reused_post_id_of_another_person_is_409(
    client: TestClient, trio: Trio
) -> None:
    p = _post(client, trio.ana.headers)
    r = client.post(
        f"{API}/posts", headers=trio.ben.headers, json={"id": p["id"], "caption": "x"}
    )
    assert r.status_code == 409 and code(r) == "id_conflict"


def test_create_post_with_media(client: TestClient, trio: Trio) -> None:
    r = client.post(
        f"{API}/posts",
        headers=trio.ana.headers,
        json={"caption": "pic", "media": [{"media_id": str(uuid.uuid4())}]},
    )
    assert r.status_code == 404  # an unknown media object is not the caller's


def test_post_visibility_matrix(client: TestClient, trio: Trio) -> None:
    """Author, follower and same-tenant stranger all see a post (for-you is
    tenant-wide); only the author and followers get it in Following."""
    p = _post(client, trio.ana.headers, "visible")
    for person in (trio.ana, trio.ben, trio.cy):
        assert (
            ok(client.get(f"{API}/posts/{p['id']}", headers=person.headers))["id"]
            == p["id"]
        )
    following = {
        name: [
            x["id"]
            for x in ok(
                client.get(f"{API}/feed?tab=following", headers=person.headers)
            )["data"]
        ]
        for name, person in (("ana", trio.ana), ("ben", trio.ben), ("cy", trio.cy))
    }
    assert p["id"] in following["ana"] and p["id"] in following["ben"]
    assert p["id"] not in following["cy"]
    foryou = [
        x["id"]
        for x in ok(client.get(f"{API}/feed?tab=foryou", headers=trio.cy.headers))[
            "data"
        ]
    ]
    assert p["id"] in foryou
    assert (
        client.get(f"{API}/posts/{uuid.uuid4()}", headers=trio.cy.headers).status_code
        == 404
    )


def test_following_feed_keyset_pagination(client: TestClient, trio: Trio) -> None:
    ids = [_post(client, trio.ana.headers, f"p{i}")["id"] for i in range(5)]
    mine = _post(client, trio.ben.headers, "mine")["id"]
    seen: list[str] = []
    cursor = None
    pages = 0
    while True:
        url = f"{API}/feed?tab=following&limit=2" + (
            f"&cursor={cursor}" if cursor else ""
        )
        page = ok(client.get(url, headers=trio.ben.headers))
        assert page["count"] == 6
        seen += [x["id"] for x in page["data"]]
        cursor = page["next_cursor"]
        pages += 1
        if cursor is None:
            break
    assert pages == 3
    # Newest first, own posts included, nothing twice.
    assert seen == [mine, *reversed(ids)]
    r = client.get(f"{API}/feed?tab=following&cursor=garbage", headers=trio.ben.headers)
    assert r.status_code == 422 and code(r) == "invalid_cursor"


def test_for_you_ranks_by_likes_then_recency(client: TestClient, trio: Trio) -> None:
    old = _post(client, trio.cy.headers, "old")["id"]
    popular = _post(client, trio.cy.headers, "popular")["id"]
    new = _post(client, trio.cy.headers, "new")["id"]
    for person in (trio.ana, trio.ben):
        ok(client.put(f"{API}/posts/{popular}/like", headers=person.headers))
    ok(client.put(f"{API}/posts/{old}/like", headers=trio.ana.headers))
    data = ok(client.get(f"{API}/feed?tab=foryou&limit=100", headers=trio.ben.headers))[
        "data"
    ]
    order = [x["id"] for x in data if x["id"] in (old, popular, new)]
    assert order == [popular, old, new]


def test_for_you_window_excludes_old_posts(
    client: TestClient, trio: Trio, db: Session
) -> None:
    p = _post(client, trio.cy.headers, "ancient")
    row = db.get(Post, uuid.UUID(p["id"]))
    assert row is not None
    row.created_at = row.created_at - timedelta(days=15)
    db.add(row)
    db.commit()
    data = ok(client.get(f"{API}/feed?tab=foryou&limit=100", headers=trio.ben.headers))[
        "data"
    ]
    assert p["id"] not in [x["id"] for x in data]


def test_like_is_idempotent_and_own_like_records_no_activity(
    client: TestClient, trio: Trio
) -> None:
    p = _post(client, trio.ana.headers)
    for _ in range(3):  # tap, double-tap, double-tap
        liked = ok(client.put(f"{API}/posts/{p['id']}/like", headers=trio.ben.headers))
    assert (liked["likes"], liked["liked"]) == (1, True)
    act = ok(client.get(f"{API}/activity", headers=trio.ana.headers))["data"]
    assert len([a for a in act if a["kind"] == "like"]) == 1
    ok(client.put(f"{API}/posts/{p['id']}/like", headers=trio.ana.headers))
    act = ok(client.get(f"{API}/activity", headers=trio.ana.headers))["data"]
    assert [a["actor"]["id"] for a in act if a["kind"] == "like"] == [str(trio.ben.id)]
    detail = ok(client.get(f"{API}/posts/{p['id']}", headers=trio.cy.headers))
    assert detail["likes"] == 2 and not detail["liked"]
    assert {x["id"] for x in detail["liked_by"]} == {str(trio.ana.id), str(trio.ben.id)}
    un = ok(client.delete(f"{API}/posts/{p['id']}/like", headers=trio.ben.headers))
    assert (un["likes"], un["liked"]) == (1, False)
    act = ok(client.get(f"{API}/activity", headers=trio.ana.headers))["data"]
    assert not [a for a in act if a["kind"] == "like"]


def test_save_and_saved_list(client: TestClient, trio: Trio) -> None:
    p = _post(client, trio.ana.headers)
    assert ok(client.put(f"{API}/posts/{p['id']}/save", headers=trio.cy.headers))[
        "saved"
    ]
    assert [
        x["id"] for x in ok(client.get(f"{API}/saved", headers=trio.cy.headers))["data"]
    ] == [p["id"]]
    assert ok(client.get(f"{API}/saved", headers=trio.ben.headers))["count"] == 0
    assert not ok(
        client.delete(f"{API}/posts/{p['id']}/save", headers=trio.cy.headers)
    )["saved"]
    assert ok(client.get(f"{API}/saved", headers=trio.cy.headers))["count"] == 0


def test_update_caption_is_author_only(client: TestClient, trio: Trio) -> None:
    p = _post(client, trio.ana.headers, "first #a")
    upd = ok(
        client.patch(
            f"{API}/posts/{p['id']}",
            headers=trio.ana.headers,
            json={"caption": "second #b"},
        )
    )
    assert (upd["caption"], upd["tags"]) == ("second #b", ["b"])
    r = client.patch(
        f"{API}/posts/{p['id']}", headers=trio.ben.headers, json={"caption": "hijack"}
    )
    assert r.status_code == 404
    assert (
        client.delete(f"{API}/posts/{p['id']}", headers=trio.ben.headers).status_code
        == 404
    )


def test_delete_and_undo_window(client: TestClient, trio: Trio, db: Session) -> None:
    p = _post(client, trio.ana.headers)
    ok(client.delete(f"{API}/posts/{p['id']}", headers=trio.ana.headers), 204)
    for person in (trio.ana, trio.ben, trio.cy):
        assert (
            client.get(f"{API}/posts/{p['id']}", headers=person.headers).status_code
            == 404
        )
    assert p["id"] not in [
        x["id"] for x in ok(client.get(f"{API}/feed", headers=trio.ben.headers))["data"]
    ]
    # Someone else cannot restore it.
    assert (
        client.post(
            f"{API}/posts/{p['id']}/restore", headers=trio.ben.headers
        ).status_code
        == 404
    )
    back = ok(client.post(f"{API}/posts/{p['id']}/restore", headers=trio.ana.headers))
    assert back["id"] == p["id"]
    ok(client.delete(f"{API}/posts/{p['id']}", headers=trio.ana.headers), 204)
    row = db.get(Post, uuid.UUID(p["id"]))
    assert row is not None and row.deleted_at is not None
    db.refresh(row)
    assert row.deleted_at is not None
    row.deleted_at = row.deleted_at - timedelta(minutes=5)
    db.add(row)
    db.commit()
    r = client.post(f"{API}/posts/{p['id']}/restore", headers=trio.ana.headers)
    assert r.status_code == 409 and code(r) == "undo_expired"


def test_deleted_post_hides_its_activity(client: TestClient, trio: Trio) -> None:
    p = _post(client, trio.ana.headers)
    ok(client.put(f"{API}/posts/{p['id']}/like", headers=trio.ben.headers))

    def kinds() -> list[str]:
        data = ok(client.get(f"{API}/activity", headers=trio.ana.headers))["data"]
        return [a["kind"] for a in data]

    assert kinds() == ["like", "follow"]
    ok(client.delete(f"{API}/posts/{p['id']}", headers=trio.ana.headers), 204)
    assert kinds() == ["follow"]


def test_tag_search(client: TestClient, trio: Trio) -> None:
    tag = f"t{uuid.uuid4().hex[:8]}"
    a = _post(client, trio.ana.headers, f"one #{tag}")["id"]
    b = _post(client, trio.cy.headers, f"two #{tag.upper()} #other")["id"]
    _post(client, trio.cy.headers, f"near miss #{tag}x")
    found = ok(client.get(f"{API}/search/tags?q=%23{tag}", headers=trio.ben.headers))
    assert found["count"] == 2 and [x["id"] for x in found["data"]] == [b, a]
    assert (
        ok(client.get(f"{API}/search/tags?q=%23", headers=trio.ben.headers))["count"]
        == 0
    )


def test_profile_posts_grid(client: TestClient, trio: Trio) -> None:
    a = _post(client, trio.ana.headers, "a")["id"]
    b = _post(client, trio.ana.headers, "b")["id"]
    grid = ok(client.get(f"{API}/people/{trio.ana.id}/posts", headers=trio.cy.headers))
    assert [x["id"] for x in grid["data"]] == [b, a] and grid["count"] == 2


# ---------------------------------------------------------------- comments


def test_comments_reply_like_and_delete(client: TestClient, trio: Trio) -> None:
    p = _post(client, trio.ana.headers)
    url = f"{API}/posts/{p['id']}/comments"
    c1 = ok(client.post(url, headers=trio.ben.headers, json={"text": "Monster"}))
    c2 = ok(
        client.post(
            url,
            headers=trio.ana.headers,
            json={"text": "thanks", "reply_to_id": c1["id"]},
        )
    )
    assert c2["reply_to_id"] == c1["id"]
    listed = ok(client.get(url, headers=trio.cy.headers))
    assert [c["id"] for c in listed["data"]] == [c1["id"], c2["id"]]
    assert (
        ok(client.get(f"{API}/posts/{p['id']}", headers=trio.cy.headers))["comments"]
        == 2
    )
    liked = ok(client.put(f"{url}/{c1['id']}/like", headers=trio.cy.headers))
    assert (liked["likes"], liked["liked"]) == (1, True)
    assert (
        ok(client.put(f"{url}/{c1['id']}/like", headers=trio.cy.headers))["likes"] == 1
    )
    assert (
        ok(client.delete(f"{url}/{c1['id']}/like", headers=trio.cy.headers))["likes"]
        == 0
    )
    # A stranger cannot delete; the post owner can, and replies go with it.
    r = client.delete(f"{url}/{c1['id']}", headers=trio.cy.headers)
    assert r.status_code == 403 and code(r) == "comment_forbidden"
    ok(client.delete(f"{url}/{c1['id']}", headers=trio.ana.headers), 204)
    assert ok(client.get(url, headers=trio.cy.headers))["count"] == 0


def test_comment_author_can_delete_own(client: TestClient, trio: Trio) -> None:
    p = _post(client, trio.ana.headers)
    url = f"{API}/posts/{p['id']}/comments"
    c = ok(client.post(url, headers=trio.cy.headers, json={"text": "mine"}))
    ok(client.delete(f"{url}/{c['id']}", headers=trio.cy.headers), 204)
    assert not [
        a
        for a in ok(client.get(f"{API}/activity", headers=trio.ana.headers))["data"]
        if a["kind"] == "comment"
    ]


def test_comment_child_must_belong_to_the_post(client: TestClient, trio: Trio) -> None:
    p1 = _post(client, trio.ana.headers, "one")
    p2 = _post(client, trio.ana.headers, "two")
    c = ok(
        client.post(
            f"{API}/posts/{p1['id']}/comments",
            headers=trio.ben.headers,
            json={"text": "x"},
        )
    )
    other = f"{API}/posts/{p2['id']}/comments"
    assert (
        client.put(f"{other}/{c['id']}/like", headers=trio.ben.headers).status_code
        == 404
    )
    assert (
        client.delete(f"{other}/{c['id']}", headers=trio.ana.headers).status_code == 404
    )
    r = client.post(
        other, headers=trio.ben.headers, json={"text": "y", "reply_to_id": c["id"]}
    )
    assert r.status_code == 404 and code(r) == "comment_not_found"


def test_comment_activity_and_mentions(
    client: TestClient, trio: Trio, bus: Bus
) -> None:
    p = _post(client, trio.ana.headers)
    bus.clear()
    ok(
        client.post(
            f"{API}/posts/{p['id']}/comments",
            headers=trio.ben.headers,
            json={"text": f"look @{trio.cy.handle} and @{trio.ben.handle}"},
        )
    )
    ana_act = ok(client.get(f"{API}/activity", headers=trio.ana.headers))["data"]
    assert [a["kind"] for a in ana_act] == ["comment", "follow"]
    cy_act = ok(client.get(f"{API}/activity", headers=trio.cy.headers))["data"]
    assert [(a["kind"], a["post_id"]) for a in cy_act] == [("mention", p["id"])]
    # Mentioning yourself records nothing.
    assert ok(client.get(f"{API}/activity", headers=trio.ben.headers))["count"] == 0
    assert bus.types(trio.cy) == ["social.activity"]
    assert bus.types(trio.ana) == ["social.activity"]


def test_caption_mentions_on_create_and_edit(client: TestClient, trio: Trio) -> None:
    p = _post(client, trio.ana.headers, f"with @{trio.ben.handle}")
    assert [
        a["kind"]
        for a in ok(client.get(f"{API}/activity", headers=trio.ben.headers))["data"]
    ] == ["mention"]
    ok(
        client.patch(
            f"{API}/posts/{p['id']}",
            headers=trio.ana.headers,
            json={"caption": f"with @{trio.ben.handle} @{trio.cy.handle}"},
        )
    )
    assert ok(client.get(f"{API}/activity", headers=trio.ben.headers))["count"] == 1
    assert [
        a["kind"]
        for a in ok(client.get(f"{API}/activity", headers=trio.cy.headers))["data"]
    ] == ["mention"]
