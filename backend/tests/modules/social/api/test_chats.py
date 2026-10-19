"""Chats: membership gates, direct-key reuse, groups, messages, reactions,
unsend, read state, mute/pin/hide, typing, and the push fallback."""

import uuid
from typing import Any

from fastapi.testclient import TestClient
from sqlmodel import Session, col, func, select

from app.modules.profile.models import PushDevice
from app.modules.social import services
from app.modules.social.models import Chat
from tests.modules.social.api.conftest import Bus, Person, Pushes, Trio
from tests.modules.social.api.helpers import API, code, ok


def _direct(client: TestClient, a: Person, b: Person) -> dict[str, Any]:
    chat: dict[str, Any] = ok(
        client.post(
            f"{API}/chats/direct", headers=a.headers, json={"user_id": str(b.id)}
        )
    )
    return chat


def _send(
    client: TestClient, who: Person, chat_id: str, text: str = "hey", **kw: Any
) -> dict[str, Any]:
    msg: dict[str, Any] = ok(
        client.post(
            f"{API}/chats/{chat_id}/messages",
            headers=who.headers,
            json={"text": text, **kw},
        )
    )
    return msg


def _device(db: Session, who: Person) -> str:
    token = f"ExponentPushToken[{uuid.uuid4().hex}]"
    from app.modules.iam.users.models import User

    user = db.get(User, who.id)
    assert user is not None
    db.add(
        PushDevice(
            owner_id=who.id, tenant_id=user.tenant_id, token=token, platform="ios"
        )
    )
    db.commit()
    return token


def test_direct_chat_reuses_direct_key(
    client: TestClient, trio: Trio, db: Session
) -> None:
    c1 = _direct(client, trio.ana, trio.ben)
    c2 = _direct(client, trio.ben, trio.ana)  # the other side opens "Message"
    assert c1["id"] == c2["id"] and not c1["is_group"]
    # The other person is the member shown in a 1:1.
    assert [m["id"] for m in c1["members"]] == [str(trio.ben.id)]
    n = db.exec(
        select(func.count())
        .select_from(Chat)
        .where(col(Chat.id) == uuid.UUID(c1["id"]))
    ).one()
    assert n == 1
    r = client.post(
        f"{API}/chats/direct",
        headers=trio.ana.headers,
        json={"user_id": str(trio.ana.id)},
    )
    assert r.status_code == 422 and code(r) == "self_chat"
    assert (
        client.post(
            f"{API}/chats/direct",
            headers=trio.ana.headers,
            json={"user_id": str(uuid.uuid4())},
        ).status_code
        == 404
    )


def test_chat_membership_gates(client: TestClient, trio: Trio) -> None:
    chat = _direct(client, trio.ana, trio.ben)
    m = _send(client, trio.ana, chat["id"])
    cid, mid = chat["id"], m["id"]
    cy = trio.cy.headers
    gated = [
        ("get", f"/chats/{cid}", None),
        ("get", f"/chats/{cid}/messages", None),
        ("post", f"/chats/{cid}/messages", {"text": "intruder"}),
        ("post", f"/chats/{cid}/read", None),
        ("post", f"/chats/{cid}/typing", None),
        ("patch", f"/chats/{cid}/me", {"muted": True}),
        ("delete", f"/chats/{cid}", None),
        ("put", f"/chats/{cid}/messages/{mid}/reaction", {"emoji": "🔥"}),
        ("delete", f"/chats/{cid}/messages/{mid}", None),
        ("patch", f"/chats/{cid}", {"name": "x"}),
        ("post", f"/chats/{cid}/members", {"user_ids": [str(trio.cy.id)]}),
    ]
    for verb, path, body in gated:
        kw: dict[str, Any] = {"headers": cy}
        if body is not None:
            kw["json"] = body
        r = getattr(client, verb)(f"{API}{path}", **kw)
        assert r.status_code == 404, (verb, path, r.status_code)
    assert ok(client.get(f"{API}/chats", headers=cy))["count"] == 0


def test_message_child_must_belong_to_the_chat(client: TestClient, trio: Trio) -> None:
    a = _direct(client, trio.ana, trio.ben)
    b = _direct(client, trio.ana, trio.cy)
    m = _send(client, trio.ana, a["id"])
    assert (
        client.put(
            f"{API}/chats/{b['id']}/messages/{m['id']}/reaction",
            headers=trio.ana.headers,
            json={"emoji": "👍"},
        ).status_code
        == 404
    )
    assert (
        client.delete(
            f"{API}/chats/{b['id']}/messages/{m['id']}", headers=trio.ana.headers
        ).status_code
        == 404
    )
    r = client.post(
        f"{API}/chats/{b['id']}/messages",
        headers=trio.ana.headers,
        json={"text": "re", "reply_to_id": m["id"]},
    )
    assert r.status_code == 404 and code(r) == "message_not_found"


def test_send_list_reply_share_and_unread(client: TestClient, trio: Trio) -> None:
    chat = _direct(client, trio.ana, trio.ben)
    cid = chat["id"]
    mid = str(uuid.uuid4())
    m1 = _send(client, trio.ana, cid, "one", id=mid)
    assert m1["id"] == mid
    assert _send(client, trio.ana, cid, "replayed", id=mid)["text"] == "one"  # replay
    post = ok(
        client.post(
            f"{API}/posts", headers=trio.cy.headers, json={"caption": "share me"}
        )
    )
    m2 = _send(client, trio.ana, cid, "look", post_id=post["id"], reply_to_id=mid)
    assert (m2["post_id"], m2["reply_to_id"]) == (post["id"], mid)
    inbox = ok(client.get(f"{API}/chats", headers=trio.ben.headers))
    row = next(c for c in inbox["data"] if c["id"] == cid)
    assert row["unread"] == 2 and row["last_message"]["id"] == m2["id"]
    assert (
        ok(client.get(f"{API}/badges", headers=trio.ben.headers))["chats_unread"] == 1
    )
    # The sender has read their own messages.
    assert (
        next(
            c
            for c in ok(client.get(f"{API}/chats", headers=trio.ana.headers))["data"]
            if c["id"] == cid
        )["unread"]
        == 0
    )
    read = ok(client.post(f"{API}/chats/{cid}/read", headers=trio.ben.headers))
    assert read["unread"] == 0
    assert (
        ok(client.get(f"{API}/badges", headers=trio.ben.headers))["chats_unread"] == 0
    )
    assert (
        client.post(
            f"{API}/chats/{cid}/messages", headers=trio.ana.headers, json={"text": " "}
        ).status_code
        == 422
    )


def test_message_pagination_newest_first(client: TestClient, trio: Trio) -> None:
    cid = _direct(client, trio.ana, trio.ben)["id"]
    sent = [_send(client, trio.ana, cid, f"m{i}")["id"] for i in range(5)]
    got: list[str] = []
    cursor = None
    while True:
        url = f"{API}/chats/{cid}/messages?limit=2" + (
            f"&cursor={cursor}" if cursor else ""
        )
        page = ok(client.get(url, headers=trio.ben.headers))
        assert page["count"] == 5
        got += [m["id"] for m in page["data"]]
        cursor = page["next_cursor"]
        if cursor is None:
            break
    assert got == list(reversed(sent))
    assert (
        client.get(
            f"{API}/chats/{cid}/messages?limit=0", headers=trio.ben.headers
        ).status_code
        == 422
    )


def test_unsend_is_sender_only(client: TestClient, trio: Trio, bus: Bus) -> None:
    cid = _direct(client, trio.ana, trio.ben)["id"]
    m = _send(client, trio.ana, cid)
    r = client.delete(f"{API}/chats/{cid}/messages/{m['id']}", headers=trio.ben.headers)
    assert r.status_code == 403 and code(r) == "not_sender"
    bus.clear()
    ok(
        client.delete(
            f"{API}/chats/{cid}/messages/{m['id']}", headers=trio.ana.headers
        ),
        204,
    )
    assert (
        ok(client.get(f"{API}/chats/{cid}/messages", headers=trio.ben.headers))["count"]
        == 0
    )
    assert bus.of(trio.ben, "chat.message") == [
        {"chat_id": cid, "message_id": m["id"], "action": "unsent"}
    ]
    assert bus.of(trio.cy) == []


def test_reactions_set_replace_remove(client: TestClient, trio: Trio, bus: Bus) -> None:
    cid = _direct(client, trio.ana, trio.ben)["id"]
    m = _send(client, trio.ana, cid)
    url = f"{API}/chats/{cid}/messages/{m['id']}/reaction"
    bus.clear()
    assert ok(client.put(url, headers=trio.ben.headers, json={"emoji": "🔥"}))[
        "reactions"
    ] == {str(trio.ben.id): "🔥"}
    assert ok(client.put(url, headers=trio.ben.headers, json={"emoji": "😂"}))[
        "reactions"
    ] == {str(trio.ben.id): "😂"}
    ok(
        client.put(url, headers=trio.ben.headers, json={"emoji": "😂"})
    )  # same again: no event
    assert ok(client.delete(url, headers=trio.ben.headers))["reactions"] == {}
    assert len(bus.of(trio.ana, "chat.reaction")) == 3
    assert bus.of(trio.cy) == []


def test_group_create_rename_add_leave(
    client: TestClient, trio: Trio, bus: Bus
) -> None:
    g = ok(
        client.post(
            f"{API}/chats/groups",
            headers=trio.ana.headers,
            json={"name": "Lifters", "member_ids": [str(trio.ben.id)]},
        )
    )
    cid = g["id"]
    assert g["is_group"] and {m["id"] for m in g["members"]} == {
        str(trio.ana.id),
        str(trio.ben.id),
    }
    assert client.get(f"{API}/chats/{cid}", headers=trio.cy.headers).status_code == 404
    ok(
        client.patch(
            f"{API}/chats/{cid}", headers=trio.ben.headers, json={"name": "Squad"}
        )
    )
    ok(
        client.post(
            f"{API}/chats/{cid}/members",
            headers=trio.ben.headers,
            json={"user_ids": [str(trio.cy.id)]},
        )
    )
    assert (
        ok(client.get(f"{API}/chats/{cid}", headers=trio.cy.headers))["name"] == "Squad"
    )
    msgs = ok(client.get(f"{API}/chats/{cid}/messages", headers=trio.cy.headers))[
        "data"
    ]
    assert [m["system"] for m in msgs] == [True, True, True]
    # System messages are not unread messages.
    assert ok(client.get(f"{API}/chats/{cid}", headers=trio.cy.headers))["unread"] == 0
    bus.clear()
    ok(client.post(f"{API}/chats/{cid}/leave", headers=trio.cy.headers), 204)
    assert client.get(f"{API}/chats/{cid}", headers=trio.cy.headers).status_code == 404
    assert bus.of(trio.cy) == []
    assert len(bus.of(trio.ana, "chat.message")) == 1
    _send(client, trio.ana, cid, "after you left")
    assert bus.of(trio.cy) == []
    # A direct chat is not a group.
    d = _direct(client, trio.ana, trio.ben)
    r = client.post(f"{API}/chats/{d['id']}/leave", headers=trio.ana.headers)
    assert r.status_code == 422 and code(r) == "not_a_group"
    r = client.post(
        f"{API}/chats/groups",
        headers=trio.ana.headers,
        json={"name": "x", "member_ids": [str(uuid.uuid4())]},
    )
    assert r.status_code == 404
    r = client.post(
        f"{API}/chats/groups",
        headers=trio.ana.headers,
        json={"name": "x", "member_ids": [str(trio.ana.id)]},
    )
    assert r.status_code == 422 and code(r) == "group_too_small"


def test_mute_pin_hide_restore(client: TestClient, trio: Trio) -> None:
    a = _direct(client, trio.ana, trio.ben)
    b = _direct(client, trio.ana, trio.cy)
    _send(client, trio.ben, a["id"])
    _send(client, trio.cy, b["id"])
    assert ok(
        client.patch(
            f"{API}/chats/{a['id']}/me", headers=trio.ana.headers, json={"pinned": True}
        )
    )["pinned"]
    order = [
        c["id"]
        for c in ok(client.get(f"{API}/chats", headers=trio.ana.headers))["data"]
    ]
    assert order == [a["id"], b["id"]]  # pinned first despite being older
    assert ok(
        client.patch(
            f"{API}/chats/{b['id']}/me", headers=trio.ana.headers, json={"muted": True}
        )
    )["muted"]
    assert (
        ok(client.get(f"{API}/badges", headers=trio.ana.headers))["chats_unread"] == 1
    )  # muted one excluded
    # Mute/pin are mine only.
    assert not ok(client.get(f"{API}/chats/{a['id']}", headers=trio.ben.headers))[
        "pinned"
    ]
    ok(client.delete(f"{API}/chats/{a['id']}", headers=trio.ana.headers), 204)
    assert [
        c["id"]
        for c in ok(client.get(f"{API}/chats", headers=trio.ana.headers))["data"]
    ] == [b["id"]]
    assert a["id"] in [
        c["id"]
        for c in ok(client.get(f"{API}/chats", headers=trio.ben.headers))["data"]
    ]
    ok(client.post(f"{API}/chats/{a['id']}/restore", headers=trio.ana.headers))
    assert a["id"] in [
        c["id"]
        for c in ok(client.get(f"{API}/chats", headers=trio.ana.headers))["data"]
    ]
    ok(client.delete(f"{API}/chats/{a['id']}", headers=trio.ana.headers), 204)
    _send(client, trio.ben, a["id"], "back?")  # a new message brings it back
    assert a["id"] in [
        c["id"]
        for c in ok(client.get(f"{API}/chats", headers=trio.ana.headers))["data"]
    ]


def test_typing_is_ephemeral_and_throttled(
    client: TestClient, trio: Trio, bus: Bus, monkeypatch: Any
) -> None:
    g = ok(
        client.post(
            f"{API}/chats/groups",
            headers=trio.ana.headers,
            json={"name": "G", "member_ids": [str(trio.ben.id)]},
        )
    )
    bus.clear()
    ok(client.post(f"{API}/chats/{g['id']}/typing", headers=trio.ana.headers), 204)
    assert bus.of(trio.ben, "chat.typing") == [
        {"chat_id": g["id"], "user_id": str(trio.ana.id)}
    ]
    assert bus.of(trio.ana) == [] and bus.of(trio.cy) == []
    assert (
        ok(client.get(f"{API}/chats/{g['id']}/messages", headers=trio.ben.headers))[
            "count"
        ]
        == 1
    )  # only "created"
    calls: list[int] = []

    def gate(_u: uuid.UUID, _c: uuid.UUID) -> bool:
        calls.append(1)
        return len(calls) == 1

    monkeypatch.setattr(services, "typing_gate", gate)
    bus.clear()
    for _ in range(3):
        ok(client.post(f"{API}/chats/{g['id']}/typing", headers=trio.ana.headers), 204)
    assert len(bus.of(trio.ben, "chat.typing")) == 1


def test_message_events_and_push_fallback(
    client: TestClient, trio: Trio, bus: Bus, pushes: Pushes, db: Session
) -> None:
    ben_tok = _device(db, trio.ben)
    cy_tok = _device(db, trio.cy)
    ana_tok = _device(db, trio.ana)
    g = ok(
        client.post(
            f"{API}/chats/groups",
            headers=trio.ana.headers,
            json={"name": "G", "member_ids": [str(trio.ben.id), str(trio.cy.id)]},
        )
    )
    cid = g["id"]
    pushes.sent.clear()
    bus.clear()
    pushes.live.add(trio.cy.id)  # Cy has the app open: the event is enough
    m = _send(client, trio.ana, cid, "lift at 6?")
    for p in (trio.ana, trio.ben, trio.cy):
        evs = bus.of(p, "chat.message")
        assert [e["message_id"] for e in evs] == [m["id"]], p.name
        assert "text" not in evs[0]  # ids and small fields only
    assert pushes.tokens() == [ben_tok]
    assert pushes.sent[0].body == "lift at 6?" and pushes.sent[0].title == "Ana · G"
    # A muted member gets the event but no push.
    ok(
        client.patch(
            f"{API}/chats/{cid}/me", headers=trio.ben.headers, json={"muted": True}
        )
    )
    pushes.sent.clear()
    _send(client, trio.ana, cid, "again")
    assert pushes.tokens() == []
    # The sender never pushes to themself.
    pushes.live.clear()
    pushes.sent.clear()
    _send(client, trio.cy, cid, "ok")
    assert ana_tok in pushes.tokens() and cy_tok not in pushes.tokens()


def test_read_receipt_event(client: TestClient, trio: Trio, bus: Bus) -> None:
    cid = _direct(client, trio.ana, trio.ben)["id"]
    _send(client, trio.ana, cid)
    bus.clear()
    ok(client.post(f"{API}/chats/{cid}/read", headers=trio.ben.headers))
    assert [e["user_id"] for e in bus.of(trio.ana, "chat.read")] == [str(trio.ben.id)]
    assert bus.of(trio.ben) == [] and bus.of(trio.cy) == []


def test_story_reply_needs_a_visible_story(client: TestClient, trio: Trio) -> None:
    s = ok(
        client.post(
            f"{API}/stories",
            headers=trio.ana.headers,
            json={"kind": "text", "text": "hi"},
        )
    )
    with_cy = _direct(client, trio.cy, trio.ana)["id"]
    r = client.post(
        f"{API}/chats/{with_cy}/messages",
        headers=trio.cy.headers,
        json={"text": "nice", "story_id": s["id"]},
    )
    assert r.status_code == 404  # Cy does not follow Ana
    with_ben = _direct(client, trio.ben, trio.ana)["id"]
    m = _send(client, trio.ben, with_ben, "nice", story_id=s["id"])
    assert m["story_id"] == s["id"]
