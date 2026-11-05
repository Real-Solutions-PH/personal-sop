"""The account's shown extras (journal, social, weather, calendar)."""

import uuid

from fastapi.testclient import TestClient
from sqlmodel import Session

from app.core.config import settings
from tests.utils.mobile import signed_in

API = f"{settings.API_V1_STR}/profile"


def test_unchosen_until_set_then_kept_in_canonical_order(
    client: TestClient, db: Session
) -> None:
    _, h = signed_in(db)
    assert client.get(API, headers=h).json()["profile"]["enabled_extras"] is None
    r = client.patch(
        API, headers=h, json={"enabled_extras": ["weather", "journal", "journal"]}
    )
    assert r.status_code == 200, r.text
    assert r.json()["enabled_extras"] == ["journal", "weather"]
    # Hiding every extra is a choice, not "unchosen".
    assert (
        client.patch(API, headers=h, json={"enabled_extras": []}).json()[
            "enabled_extras"
        ]
        == []
    )


def test_null_and_other_fields_leave_the_choice_alone(
    client: TestClient, db: Session
) -> None:
    _, h = signed_in(db)
    client.patch(API, headers=h, json={"enabled_extras": ["social"]})
    assert client.patch(API, headers=h, json={"enabled_extras": None}).json()[
        "enabled_extras"
    ] == ["social"]
    assert client.patch(API, headers=h, json={"privacy_hidden": True}).json()[
        "enabled_extras"
    ] == ["social"]


def test_unknown_extra_is_refused(client: TestClient, db: Session) -> None:
    _, h = signed_in(db)
    r = client.patch(API, headers=h, json={"enabled_extras": ["journal", "habits"]})
    assert r.status_code == 422
    assert client.get(API, headers=h).json()["profile"]["enabled_extras"] is None


def test_extras_sync_through_the_profile_entity(
    client: TestClient, db: Session
) -> None:
    _, h = signed_in(db)
    op = {
        "op_id": str(uuid.uuid4()),
        "kind": "upsert",
        "name": "profile",
        "id": str(uuid.uuid4()),
        "data": {"enabled_extras": ["journal", "calendar"]},
    }
    res = client.post(
        f"{settings.API_V1_STR}/sync/push", headers=h, json={"ops": [op]}
    ).json()["results"]
    assert [x["status"] for x in res] == ["applied"], res
    pulled = client.get(f"{settings.API_V1_STR}/sync/pull", headers=h).json()["changes"]
    row = next(c["row"] for c in pulled if c["entity"] == "profile")
    assert row["enabled_extras"] == ["journal", "calendar"]
