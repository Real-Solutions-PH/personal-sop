"""People, the follow graph, close friends, search, scores and drafts."""

import uuid
from collections.abc import Callable

from fastapi.testclient import TestClient
from sqlmodel import Session

from app.core.config import settings
from app.modules.iam.users.models import User
from app.modules.media.models import MediaObject
from tests.modules.social.api.conftest import Person, Trio
from tests.modules.social.api.helpers import API, code, ok


def test_profile_view_counts_and_viewer_state(client: TestClient, trio: Trio) -> None:
    ana, ben, cy = trio.ana, trio.ben, trio.cy
    ok(
        client.patch(
            f"{API}/me", headers=ana.headers, json={"bio": "Lifts", "accent": "fit"}
        )
    )
    as_ben = ok(client.get(f"{API}/people/{ana.id}", headers=ben.headers))
    assert (as_ben["name"], as_ben["handle"], as_ben["bio"], as_ben["accent"]) == (
        "Ana",
        ana.handle,
        "Lifts",
        "fit",
    )
    assert (as_ben["followers"], as_ben["following"]) == (1, 0)
    assert as_ben["is_following"] and not as_ben["is_me"]
    assert as_ben["scores_visible"]
    as_cy = ok(client.get(f"{API}/people/{ana.id}", headers=cy.headers))
    assert not as_cy["is_following"] and not as_cy["scores_visible"]
    me = ok(client.get(f"{API}/me", headers=ben.headers))
    assert (me["is_me"], me["followers"], me["following"]) == (True, 0, 1)


def test_unknown_person_is_404(client: TestClient, trio: Trio) -> None:
    r = client.get(f"{API}/people/{uuid.uuid4()}", headers=trio.ana.headers)
    assert r.status_code == 404 and code(r) == "person_not_found"
    r = client.put(f"{API}/people/{uuid.uuid4()}/follow", headers=trio.ana.headers)
    assert r.status_code == 404


def test_follow_unfollow_is_idempotent(client: TestClient, trio: Trio) -> None:
    ana, cy = trio.ana, trio.cy
    for _ in range(2):
        p = ok(client.put(f"{API}/people/{ana.id}/follow", headers=cy.headers))
        assert p["is_following"] and p["followers"] == 2
    # One follow activity however many times the button is pressed.
    act = ok(client.get(f"{API}/activity", headers=ana.headers))
    follows = [
        a
        for a in act["data"]
        if a["kind"] == "follow" and a["actor"]["id"] == str(cy.id)
    ]
    assert len(follows) == 1
    for _ in range(2):
        p = ok(client.delete(f"{API}/people/{ana.id}/follow", headers=cy.headers))
        assert not p["is_following"] and p["followers"] == 1
    # Unfollowing withdraws the follow activity.
    act = ok(client.get(f"{API}/activity", headers=ana.headers))
    assert not [a for a in act["data"] if a["actor"]["id"] == str(cy.id)]
    # Following again revives it rather than stacking a second row.
    ok(client.put(f"{API}/people/{ana.id}/follow", headers=cy.headers))
    act = ok(client.get(f"{API}/activity", headers=ana.headers))
    assert len([a for a in act["data"] if a["actor"]["id"] == str(cy.id)]) == 1


def test_cannot_follow_yourself(client: TestClient, trio: Trio) -> None:
    r = client.put(f"{API}/people/{trio.ana.id}/follow", headers=trio.ana.headers)
    assert r.status_code == 422 and code(r) == "self_follow"


def test_follower_and_following_lists_paginate(
    client: TestClient, trio: Trio, people: Callable[[str], Person]
) -> None:
    ana = trio.ana
    extra = [people(f"Fan{i}") for i in range(3)]
    for p in [trio.cy, *extra]:
        ok(client.put(f"{API}/people/{ana.id}/follow", headers=p.headers))
    page = ok(
        client.get(f"{API}/people/{ana.id}/followers?limit=2", headers=ana.headers)
    )
    assert page["count"] == 5 and len(page["data"]) == 2
    # Newest edge first.
    assert page["data"][0]["id"] == str(extra[-1].id)
    rest = ok(
        client.get(
            f"{API}/people/{ana.id}/followers?skip=4&limit=2", headers=ana.headers
        )
    )
    assert len(rest["data"]) == 1 and rest["data"][0]["id"] == str(trio.ben.id)
    following = ok(
        client.get(f"{API}/people/{trio.ben.id}/following", headers=trio.cy.headers)
    )
    assert [p["id"] for p in following["data"]] == [str(ana.id)]
    assert (
        client.get(
            f"{API}/people/{ana.id}/followers?limit=101", headers=ana.headers
        ).status_code
        == 422
    )
    assert (
        client.get(
            f"{API}/people/{ana.id}/followers?skip=-1", headers=ana.headers
        ).status_code
        == 422
    )


def test_close_friend_toggle(client: TestClient, trio: Trio) -> None:
    ana, ben = trio.ana, trio.ben
    p = ok(
        client.put(
            f"{API}/people/{ben.id}/close-friend",
            headers=ana.headers,
            json={"close_friend": True},
        )
    )
    assert p["close_friend"]
    assert [
        x["id"]
        for x in ok(client.get(f"{API}/close-friends", headers=ana.headers))["data"]
    ] == [str(ben.id)]
    # Only the list owner sees it: Ben's own view of Ana says nothing.
    assert not ok(client.get(f"{API}/people/{ana.id}", headers=ben.headers))[
        "close_friend"
    ]
    p = ok(
        client.put(
            f"{API}/people/{ben.id}/close-friend",
            headers=ana.headers,
            json={"close_friend": False},
        )
    )
    assert not p["close_friend"]
    assert ok(client.get(f"{API}/close-friends", headers=ana.headers))["count"] == 0
    r = client.put(
        f"{API}/people/{ana.id}/close-friend",
        headers=ana.headers,
        json={"close_friend": True},
    )
    assert r.status_code == 422


def test_people_search_by_name_and_handle(client: TestClient, trio: Trio) -> None:
    ana = trio.ana
    by_handle = ok(
        client.get(
            f"{API}/search/people?q=@{ana.handle.upper()}", headers=trio.cy.headers
        )
    )
    assert [p["id"] for p in by_handle["data"]] == [str(ana.id)]
    by_name = ok(
        client.get(f"{API}/search/people?q={ana.handle[:4]}", headers=trio.cy.headers)
    )
    assert str(ana.id) in [p["id"] for p in by_name["data"]]
    # LIKE wildcards are literal.
    assert (
        ok(client.get(f"{API}/search/people?q=%25", headers=trio.cy.headers))["count"]
        == 0
    )
    assert (
        ok(client.get(f"{API}/search/people?q=", headers=trio.cy.headers))["count"] == 0
    )


def test_explore_suggests_people_not_followed(client: TestClient, trio: Trio) -> None:
    ex = ok(client.get(f"{API}/explore", headers=trio.ben.headers))
    ids = [p["id"] for p in ex["suggested"]]
    # Never yourself or someone you already follow; at most 20. (Who fills the
    # 20 depends on everyone else in the tenant, so it is not asserted.)
    assert str(trio.ana.id) not in ids and str(trio.ben.id) not in ids
    assert len(ids) <= 20 and len(set(ids)) == len(ids)


def test_scorecard_is_hidden_from_non_followers(client: TestClient, trio: Trio) -> None:
    r = client.get(f"{API}/people/{trio.ana.id}/scorecard", headers=trio.cy.headers)
    assert r.status_code == 404 and code(r) == "scorecard_not_found"


def test_scorecard_respects_show_scores(client: TestClient, trio: Trio) -> None:
    ok(client.patch(f"{API}/me", headers=trio.ana.headers, json={"show_scores": False}))
    assert not ok(client.get(f"{API}/people/{trio.ana.id}", headers=trio.ben.headers))[
        "scores_visible"
    ]
    r = client.get(f"{API}/people/{trio.ana.id}/scorecard", headers=trio.ben.headers)
    assert r.status_code == 404


def test_scorecard_for_a_follower(client: TestClient, trio: Trio) -> None:
    card = ok(
        client.get(f"{API}/people/{trio.ana.id}/scorecard", headers=trio.ben.headers)
    )
    assert card["person_id"] == str(trio.ana.id)
    assert {
        "life",
        "delta",
        "streak",
        "best",
        "rates",
        "stats",
        "trophies",
    } <= card.keys()


def test_leaderboard_respects_show_scores(client: TestClient, trio: Trio) -> None:
    ok(client.put(f"{API}/people/{trio.cy.id}/follow", headers=trio.ben.headers))
    ok(client.patch(f"{API}/me", headers=trio.cy.headers, json={"show_scores": False}))
    board = ok(client.get(f"{API}/leaderboard", headers=trio.ben.headers))
    ids = [r["person"]["id"] for r in board["data"]]
    assert str(trio.ben.id) in ids and str(trio.ana.id) in ids
    assert str(trio.cy.id) not in ids
    assert [r["rank"] for r in board["data"]] == list(range(1, len(ids) + 1))


def test_drafts_get_put_clear(client: TestClient, trio: Trio) -> None:
    h = trio.ana.headers
    assert ok(client.get(f"{API}/drafts/post", headers=h))["body"] == {}
    ok(client.put(f"{API}/drafts/post", headers=h, json={"body": {"caption": "wip"}}))
    ok(client.put(f"{API}/drafts/story", headers=h, json={"body": {"text": "hi"}}))
    assert ok(client.get(f"{API}/drafts/post", headers=h))["body"] == {"caption": "wip"}
    # Another person never sees my drafts.
    assert ok(client.get(f"{API}/drafts/post", headers=trio.ben.headers))["body"] == {}
    ok(client.delete(f"{API}/drafts/post", headers=h), 204)
    assert ok(client.get(f"{API}/drafts/post", headers=h))["body"] == {}
    # Re-saving revives the natural-key row.
    ok(client.put(f"{API}/drafts/post", headers=h, json={"body": {"caption": "again"}}))
    assert ok(client.get(f"{API}/drafts/post", headers=h))["body"] == {
        "caption": "again"
    }
    assert client.get(f"{API}/drafts/reel", headers=h).status_code == 422
    big = {"caption": "x" * 70_000}
    r = client.put(f"{API}/drafts/post", headers=h, json={"body": big})
    assert r.status_code == 422 and code(r) == "draft_too_large"
    # Posting clears both drafts (the prototype resets ``drafts``).
    ok(client.post(f"{API}/posts", headers=h, json={"caption": "posted"}))
    assert ok(client.get(f"{API}/drafts/post", headers=h))["body"] == {}
    assert ok(client.get(f"{API}/drafts/story", headers=h))["body"] == {}


def test_requires_auth(client: TestClient) -> None:
    assert client.get(f"{API}/feed").status_code in (401, 403)


def _ready_photo(db: Session, who: Person) -> MediaObject:
    user = db.get(User, who.id)
    assert user is not None
    media = MediaObject(
        owner_id=who.id,
        tenant_id=user.tenant_id,
        kind="image",
        storage_key=f"u/{who.id}/{uuid.uuid4()}",
        mime="image/jpeg",
        size_bytes=10,
        state="ready",
    )
    db.add(media)
    db.commit()
    db.refresh(media)
    return media


def test_a_persons_photo_url_reaches_every_viewer(
    client: TestClient, db: Session, trio: Trio
) -> None:
    """The device cannot read another person's media object (owner-only), so
    the brief carries a URL any viewer in the tenant can load."""
    photo = _ready_photo(db, trio.ana)
    ok(
        client.patch(
            f"{settings.API_V1_STR}/profile",
            headers=trio.ana.headers,
            json={"photo_media_id": str(photo.id)},
        )
    )
    for viewer in (trio.ben, trio.cy):
        person = ok(client.get(f"{API}/people/{trio.ana.id}", headers=viewer.headers))
        assert person["photo_url"] and photo.storage_key in person["photo_url"]
    nobody = ok(client.get(f"{API}/people/{trio.cy.id}", headers=trio.ben.headers))
    assert nobody["photo_url"] is None


def test_me_reports_my_show_scores_setting(client: TestClient, trio: Trio) -> None:
    assert ok(client.get(f"{API}/me", headers=trio.ana.headers))["show_scores"] is True
    ok(client.patch(f"{API}/me", headers=trio.ana.headers, json={"show_scores": False}))
    assert ok(client.get(f"{API}/me", headers=trio.ana.headers))["show_scores"] is False


def test_explore_skips_unfinished_signups(
    client: TestClient, db: Session, trio: Trio
) -> None:
    """An account that never chose a name and handle is not suggested:
    there is nothing to show for it."""
    from tests.utils.mobile import signed_in

    blank, _ = signed_in(db)
    # Two followers rank it near the top of the suggestions it must miss.
    for who in (trio.ana, trio.ben):
        ok(client.put(f"{API}/people/{blank.id}/follow", headers=who.headers))
    ex = ok(client.get(f"{API}/explore", headers=trio.cy.headers))
    ids = [p["id"] for p in ex["suggested"]]
    assert str(blank.id) not in ids and str(trio.ana.id) in ids
