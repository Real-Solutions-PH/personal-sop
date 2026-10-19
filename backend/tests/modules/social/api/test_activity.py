"""Activity fan-out, unread counts, the Today card and tenant isolation."""

import secrets
import uuid

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session

from app.modules.iam.tenants.models import Tenant
from tests.modules.social.api.conftest import Bus, Pushes, Trio
from tests.modules.social.api.helpers import API, ok
from tests.utils.user import create_auth_user
from tests.utils.utils import auth_headers


def test_activity_fan_out_and_mark_read(
    client: TestClient, trio: Trio, bus: Bus
) -> None:
    ana, ben, cy = trio.ana, trio.ben, trio.cy
    post = ok(client.post(f"{API}/posts", headers=ana.headers, json={"caption": "pr"}))
    bus.clear()
    ok(client.put(f"{API}/posts/{post['id']}/like", headers=ben.headers))
    ok(
        client.post(
            f"{API}/posts/{post['id']}/comments",
            headers=cy.headers,
            json={"text": f"wow @{ben.handle}"},
        )
    )
    ok(client.put(f"{API}/people/{ana.id}/follow", headers=cy.headers))
    act = ok(client.get(f"{API}/activity", headers=ana.headers))
    # Newest first: Cy's follow, Cy's comment, Ben's like, Ben's (setup) follow.
    assert [(a["kind"], a["actor"]["id"]) for a in act["data"]] == [
        ("follow", str(cy.id)),
        ("comment", str(cy.id)),
        ("like", str(ben.id)),
        ("follow", str(ben.id)),
    ]
    assert act["unread"] == 4 and all(a["unread"] for a in act["data"])
    # Each recipient was nudged for exactly their own activity.
    assert len(bus.of(ana, "social.activity")) == 3
    assert [e["kind"] for e in bus.of(ben, "social.activity")] == ["mention"]
    assert bus.of(cy, "social.activity") == []
    assert ok(client.get(f"{API}/badges", headers=ana.headers))["activity_unread"] == 4
    assert (
        ok(client.post(f"{API}/activity/read", headers=ana.headers))["activity_unread"]
        == 0
    )
    act = ok(client.get(f"{API}/activity", headers=ana.headers))
    assert act["unread"] == 0 and not any(a["unread"] for a in act["data"])
    # Nobody else reads Ana's activity.
    assert ok(client.get(f"{API}/activity", headers=cy.headers))["count"] == 0
    page = ok(client.get(f"{API}/activity?limit=1&skip=1", headers=ana.headers))
    assert page["count"] == 4 and len(page["data"]) == 1


def test_mention_pushes_when_not_live(
    client: TestClient, trio: Trio, pushes: Pushes, db: Session
) -> None:
    from app.modules.iam.users.models import User
    from app.modules.profile.models import PushDevice

    user = db.get(User, trio.cy.id)
    assert user is not None
    db.add(
        PushDevice(
            owner_id=trio.cy.id,
            tenant_id=user.tenant_id,
            token="ExponentPushToken[cy]",
            platform="android",
        )
    )
    db.commit()
    ok(
        client.post(
            f"{API}/posts",
            headers=trio.ana.headers,
            json={"caption": f"hi @{trio.cy.handle}"},
        )
    )
    assert pushes.tokens() == ["ExponentPushToken[cy]"]
    pushes.sent.clear()
    pushes.live.add(trio.cy.id)
    ok(
        client.post(
            f"{API}/posts",
            headers=trio.ana.headers,
            json={"caption": f"again @{trio.cy.handle}"},
        )
    )
    assert pushes.tokens() == []


def test_post_event_reaches_followers_only(
    client: TestClient, trio: Trio, bus: Bus
) -> None:
    post = ok(
        client.post(f"{API}/posts", headers=trio.ana.headers, json={"caption": "new"})
    )
    assert [e["post_id"] for e in bus.of(trio.ben, "social.post")] == [post["id"]]
    assert bus.of(trio.cy) == []


def test_today_card(client: TestClient, trio: Trio) -> None:
    ana, ben = trio.ana, trio.ben
    post = ok(
        client.post(f"{API}/posts", headers=ana.headers, json={"caption": "latest"})
    )
    ok(
        client.post(
            f"{API}/stories", headers=ana.headers, json={"kind": "text", "text": "s"}
        )
    )
    chat = ok(
        client.post(
            f"{API}/chats/direct", headers=ana.headers, json={"user_id": str(ben.id)}
        )
    )
    ok(
        client.post(
            f"{API}/chats/{chat['id']}/messages",
            headers=ana.headers,
            json={"text": "yo"},
        )
    )
    today = ok(client.get(f"{API}/today", headers=ben.headers))
    assert today["latest_post"]["id"] == post["id"]
    assert [p["id"] for p in today["unseen_story_people"]] == [str(ana.id)]
    assert today["chats_unread"] == 1
    empty = ok(client.get(f"{API}/today", headers=trio.cy.headers))
    assert empty["latest_post"] is None and empty["unseen_story_people"] == []


@pytest.fixture()
def outsider(db: Session) -> dict[str, str]:
    tenant = Tenant(name="Elsewhere", slug=f"elsewhere-{secrets.token_hex(4)}")
    db.add(tenant)
    db.commit()
    db.refresh(tenant)
    from tests.utils.utils import random_email, random_lower_string

    email, password = random_email(), random_lower_string()
    create_auth_user(db, email=email, password=password, tenant_id=tenant.id)
    return auth_headers(email, password)


def test_another_tenant_sees_nothing(
    client: TestClient, trio: Trio, outsider: dict[str, str]
) -> None:
    post = ok(
        client.post(
            f"{API}/posts", headers=trio.ana.headers, json={"caption": "tenant only"}
        )
    )
    chat = ok(
        client.post(
            f"{API}/chats/direct",
            headers=trio.ana.headers,
            json={"user_id": str(trio.ben.id)},
        )
    )
    assert client.get(f"{API}/posts/{post['id']}", headers=outsider).status_code == 404
    assert (
        client.get(f"{API}/people/{trio.ana.id}", headers=outsider).status_code == 404
    )
    assert (
        client.put(f"{API}/people/{trio.ana.id}/follow", headers=outsider).status_code
        == 404
    )
    assert client.get(f"{API}/chats/{chat['id']}", headers=outsider).status_code == 404
    assert (
        client.post(
            f"{API}/chats/direct", headers=outsider, json={"user_id": str(trio.ana.id)}
        ).status_code
        == 404
    )
    foryou = ok(client.get(f"{API}/feed?tab=foryou&limit=100", headers=outsider))
    assert post["id"] not in [p["id"] for p in foryou["data"]]
    assert ok(client.get(f"{API}/search/people?q=Ana", headers=outsider))["count"] == 0
    assert str(uuid.UUID(str(trio.ana.id))) not in [
        p["id"] for p in ok(client.get(f"{API}/explore", headers=outsider))["suggested"]
    ]
