import base64
import json
import time
import uuid
from typing import Any

import pytest
from fastapi.testclient import TestClient
from pydantic import SecretStr
from sqlmodel import Session

from app.core.config import settings
from app.modules.iam.users import repo as user_repo
from app.modules.profile.models import UserProfile
from app.modules.webhooks import signature
from tests.utils.mobile import signed_in

URL = f"{settings.API_V1_STR}/webhooks/supabase-auth"
SECRET = "v1,whsec_" + base64.b64encode(b"k" * 32).decode()


@pytest.fixture(autouse=True)
def hook_secret(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "SUPABASE_AUTH_HOOK_SECRET", SecretStr(SECRET))


def _send(
    client: TestClient,
    event: dict[str, Any],
    *,
    msg_id: str | None = None,
    ts: int | None = None,
    secret: str = SECRET,
) -> Any:
    body = json.dumps(event).encode()
    mid = msg_id or f"msg_{uuid.uuid4().hex}"
    stamp = ts if ts is not None else int(time.time())
    headers = {
        "webhook-id": mid,
        "webhook-timestamp": str(stamp),
        "webhook-signature": signature.sign(secret, mid, stamp, body),
        "content-type": "application/json",
    }
    return client.post(URL, content=body, headers=headers)


def test_signature_unit_rules() -> None:
    body = b'{"a":1}'
    sig = signature.sign(SECRET, "m1", 1000, body)
    signature.verify(
        SECRET, msg_id="m1", timestamp="1000", signature=sig, body=body, now=1000
    )
    # several signatures, one valid
    signature.verify(
        SECRET,
        msg_id="m1",
        timestamp="1000",
        signature=f"v1,AAAA {sig}",
        body=body,
        now=1000,
    )
    for bad in (
        {"body": b'{"a":2}'},
        {"timestamp": "1001"},
        {"now": 1000 + 301},
        {"signature": sig.replace("v1,", "v2,")},
        {"msg_id": None},
        {"timestamp": "12x"},
    ):
        kwargs: dict[str, Any] = {
            "msg_id": "m1",
            "timestamp": "1000",
            "signature": sig,
            "body": body,
            "now": 1000,
        }
        kwargs.update(bad)
        with pytest.raises(signature.InvalidSignature):
            signature.verify(SECRET, **kwargs)


def test_delete_event_erases_user_and_their_rows(
    client: TestClient, db: Session
) -> None:
    user, h = signed_in(db)
    uid = user.id
    assert client.get(f"{settings.API_V1_STR}/profile", headers=h).status_code == 200
    event = {
        "type": "DELETE",
        "schema": "auth",
        "table": "users",
        "old_record": {"id": str(uid)},
        "record": None,
    }
    r = _send(client, event)
    assert r.status_code == 200 and r.json()["result"] == "erased"
    db.expire_all()
    assert user_repo.get_by_id(session=db, user_id=uid) is None
    assert db.query(UserProfile).filter(UserProfile.owner_id == uid).count() == 0
    again = _send(client, event)
    assert again.json()["result"] == "absent"


def test_replay_and_forgery_are_refused(client: TestClient, db: Session) -> None:
    user, _ = signed_in(db)
    event = {
        "type": "UPDATE",
        "schema": "auth",
        "table": "users",
        "record": {"id": str(user.id), "email": user.email},
    }
    first = _send(client, event, msg_id="msg_fixed_replay")
    assert first.status_code == 200
    replay = _send(client, event, msg_id="msg_fixed_replay")
    assert replay.json()["result"] == "duplicate"
    forged = _send(
        client, event, secret="v1,whsec_" + base64.b64encode(b"x" * 32).decode()
    )
    assert forged.status_code == 401 and forged.json()["code"] == "invalid_signature"
    old = _send(client, event, ts=int(time.time()) - 3600)
    assert old.status_code == 401
    unsigned = client.post(URL, json=event)
    assert unsigned.status_code == 401


def test_email_update_and_ignored_events(client: TestClient, db: Session) -> None:
    user, _ = signed_in(db)
    new_email = f"moved-{uuid.uuid4().hex[:8]}@example.com"
    r = _send(
        client,
        {
            "type": "UPDATE",
            "schema": "auth",
            "table": "users",
            "record": {"id": str(user.id), "email": new_email},
        },
    )
    assert r.json()["result"] == "updated"
    db.expire_all()
    refreshed = user_repo.get_by_id(session=db, user_id=user.id)
    assert refreshed is not None and refreshed.email == new_email
    assert (
        _send(
            client,
            {
                "type": "DELETE",
                "schema": "public",
                "table": "users",
                "old_record": {"id": str(user.id)},
            },
        ).json()["result"]
        == "ignored"
    )
    assert (
        _send(
            client,
            {
                "type": "DELETE",
                "schema": "auth",
                "table": "users",
                "old_record": {"id": "nope"},
            },
        ).json()["result"]
        == "ignored"
    )


def test_disabled_without_secret(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(settings, "SUPABASE_AUTH_HOOK_SECRET", None)
    assert client.post(URL, json={}).status_code == 404
