"""Invite links (``app.modules.invites``) for a joint account: single-use,
seven days, revocable, readable by anyone holding one; and the fences of
who makes, lists, revokes and accepts them."""

import uuid
from datetime import timedelta
from typing import Any

from sqlmodel import Session, select

from app.core.config import settings
from app.modules.invites.models import Invite
from app.modules.invites.services import hash_token
from tests.modules.shared_finance.api.conftest import Member, Trio

INVITES = f"{settings.API_V1_STR}/invites"
KIND = "finance_account"


def _code(r: Any) -> str:
    detail = r.get("detail", r)
    return str(detail.get("code") if isinstance(detail, dict) else r.get("code"))


def _call(
    m: Member, method: str, path: str, body: Any = None, status: int = 200
) -> Any:
    r = m.c.request(method, f"{INVITES}{path}", headers=m.headers, json=body)
    assert r.status_code == status, r.text
    return r.json() if r.content else None


def _link(t: Trio, by: Member | None = None, status: int = 200) -> Any:
    return _call(
        by or t.kai,
        "POST",
        "",
        {"kind": KIND, "object_id": t.kai.account},
        status,
    )


def _token(link: dict[str, Any]) -> str:
    return str(link["token"])


def test_link_open_accept_then_used(trio: Trio, db: Session) -> None:
    link = _link(trio)
    assert link["url"].endswith(f"/i/{link['token']}")
    assert len(link["token"]) >= 32
    # Only the hash is kept.
    row = db.exec(select(Invite).where(Invite.id == uuid.UUID(link["id"]))).one()
    assert row.token_hash == hash_token(link["token"]) != link["token"]
    assert row.expires_at - row.created_at == timedelta(days=7)

    # Sam is connected to nobody: the link is enough.
    seen = _call(trio.sam, "GET", f"/token/{_token(link)}")
    assert seen["state"] == "open" and seen["inviter"]["name"] == "Kai"
    assert seen["subject"]["label"] == "Joint account"
    assert seen["subject"]["href"] == f"/finance/shared/account/{trio.kai.account}"

    out = _call(trio.sam, "POST", f"/token/{_token(link)}/accept")
    assert out["joined"] is True
    view = trio.sam.get(f"/accounts/{trio.kai.account}")
    assert view["my_status"] == "active" and view["balance_minor"] == 5_000_000

    # Opening it again: already in, nothing consumed twice.
    again = _call(trio.sam, "POST", f"/token/{_token(link)}/accept")
    assert again["joined"] is False
    assert _call(trio.sam, "GET", f"/token/{_token(link)}")["state"] == "member"
    # Anyone else: used up, and nothing about the account is shown.
    seen = _call(trio.mia, "GET", f"/token/{_token(link)}")
    assert seen["state"] == "used" and seen["subject"] is None
    r = _call(trio.mia, "POST", f"/token/{_token(link)}/accept", status=410)
    assert _code(r) == "invite_used"


def test_expired_link(trio: Trio, db: Session) -> None:
    link = _link(trio)
    row = db.get(Invite, uuid.UUID(link["id"]))
    assert row is not None
    row.created_at = row.created_at - timedelta(days=8)
    row.expires_at = row.expires_at - timedelta(days=8)
    db.add(row)
    db.commit()
    seen = _call(trio.sam, "GET", f"/token/{_token(link)}")
    assert seen["state"] == "expired" and seen["subject"] is None
    r = _call(trio.sam, "POST", f"/token/{_token(link)}/accept", status=410)
    assert _code(r) == "invite_expired"
    trio.sam.get(f"/accounts/{trio.kai.account}", 404)


def test_revoked_link_and_pending_list(trio: Trio) -> None:
    a, b = _link(trio), _link(trio)
    listed = _call(trio.kai, "GET", f"?kind={KIND}&object_id={trio.kai.account}")
    assert {x["id"] for x in listed["data"]} == {a["id"], b["id"]}
    assert "token" not in listed["data"][0]
    out = _call(trio.kai, "POST", f"/{a['id']}/revoke")
    assert out["revoked_at"] is not None
    listed = _call(trio.kai, "GET", f"?kind={KIND}&object_id={trio.kai.account}")
    assert [x["id"] for x in listed["data"]] == [b["id"]]
    assert _call(trio.sam, "GET", f"/token/{_token(a)}")["state"] == "revoked"
    r = _call(trio.sam, "POST", f"/token/{_token(a)}/accept", status=410)
    assert _code(r) == "invite_revoked"


def test_own_link(trio: Trio) -> None:
    link = _link(trio)
    assert _call(trio.kai, "GET", f"/token/{_token(link)}")["state"] == "own"
    r = _call(trio.kai, "POST", f"/token/{_token(link)}/accept", status=409)
    assert _code(r) == "own_invite"


# ---------------------------------------------------------------- fences


def test_fence_stranger_cannot_make_list_or_revoke_links(trio: Trio) -> None:
    r = _link(trio, by=trio.sam, status=404)
    assert _code(r) == "account_not_found"
    _call(trio.sam, "GET", f"?kind={KIND}&object_id={trio.kai.account}", status=404)
    link = _link(trio)
    r = _call(trio.sam, "POST", f"/{link['id']}/revoke", status=404)
    assert _code(r) == "account_not_found"


def test_fence_member_cannot_make_links(trio: Trio) -> None:
    trio.kai.post(
        f"/accounts/{trio.kai.account}/share", {"member_ids": [str(trio.mia.id)]}
    )
    trio.mia.post(
        "/groups/respond",
        {"kind": "account", "object_id": trio.kai.account, "accept": True},
    )
    r = _link(trio, by=trio.mia, status=403)
    assert _code(r) == "owner_only"


def test_fence_unknown_kind_and_token(trio: Trio) -> None:
    r = _call(
        trio.kai,
        "POST",
        "",
        {"kind": "nope", "object_id": trio.kai.account},
        status=422,
    )
    assert _code(r) == "invite_kind_unknown"
    r = _call(trio.sam, "GET", f"/token/{'x' * 32}", status=404)
    assert _code(r) == "invite_not_found"
    r = _call(trio.sam, "POST", f"/token/{'x' * 32}/accept", status=404)
    assert _code(r) == "invite_not_found"


def test_fence_archived_account_link_does_not_join(trio: Trio) -> None:
    link = _link(trio)
    trio.kai.fin.patch(f"/accounts/{trio.kai.account}", {"archived": True})
    r = _call(trio.sam, "POST", f"/token/{_token(link)}/accept", status=409)
    assert _code(r) == "account_archived"
    trio.sam.get(f"/accounts/{trio.kai.account}", 404)
