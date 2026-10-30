"""A profile edit synced with a handle the server refuses keeps the rest of
the edit; the REST route still reports the refusal."""

import uuid
from typing import Any

from fastapi.testclient import TestClient
from sqlmodel import Session

from app.core.config import settings
from tests.utils.mobile import signed_in

API = settings.API_V1_STR


def _handle() -> str:
    return f"u{uuid.uuid4().hex[:10]}"


def _profile_op(**data: Any) -> dict[str, Any]:
    return {
        "op_id": str(uuid.uuid4()),
        "kind": "upsert",
        "name": "profile",
        "id": str(uuid.uuid4()),
        "data": data,
    }


def _push(client: TestClient, headers: dict[str, str], op: dict[str, Any]) -> Any:
    r = client.post(f"{API}/sync/push", headers=headers, json={"ops": [op]})
    assert r.status_code == 200, r.text
    return r.json()["results"][0]


def _named(client: TestClient, headers: dict[str, str], handle: str) -> None:
    r = client.patch(
        f"{API}/profile", headers=headers, json={"name": "Old", "handle": handle}
    )
    assert r.status_code == 200, r.text


def test_a_taken_handle_keeps_the_name_change(client: TestClient, db: Session) -> None:
    _, other = signed_in(db)
    held = _handle()
    _named(client, other, held)
    _, me = signed_in(db)
    mine = _handle()
    _named(client, me, mine)

    res = _push(client, me, _profile_op(name="Kai Noah", handle=held))
    assert res["status"] == "applied", res
    assert (res["row"]["name"], res["row"]["handle"]) == ("Kai Noah", mine)
    p = client.get(f"{API}/profile", headers=me).json()["profile"]
    assert (p["name"], p["handle"]) == ("Kai Noah", mine)


def test_a_reserved_handle_keeps_the_name_change(
    client: TestClient, db: Session
) -> None:
    _, me = signed_in(db)
    mine = _handle()
    _named(client, me, mine)
    res = _push(client, me, _profile_op(name="New Name", handle="admin"))
    assert res["status"] == "applied", res
    assert (res["row"]["name"], res["row"]["handle"]) == ("New Name", mine)


def test_my_own_handle_resent_is_not_refused(client: TestClient, db: Session) -> None:
    _, me = signed_in(db)
    mine = _handle()
    _named(client, me, mine)
    res = _push(client, me, _profile_op(name="Again", handle=mine))
    assert (res["status"], res["row"]["handle"]) == ("applied", mine)


def test_rest_patch_with_a_taken_handle_is_still_409(
    client: TestClient, db: Session
) -> None:
    _, other = signed_in(db)
    held = _handle()
    _named(client, other, held)
    _, me = signed_in(db)
    r = client.patch(f"{API}/profile", headers=me, json={"handle": held})
    assert r.status_code == 409, r.text
    body = r.json()
    assert body.get("detail", body)["code"] == "handle_taken"
