"""The account's Home arrangement: section order and Home-only hiding."""

import uuid

from fastapi.testclient import TestClient
from sqlmodel import Session

from app.core.config import settings
from tests.utils.mobile import signed_in

API = f"{settings.API_V1_STR}/profile"


def test_default_until_edited_then_kept_as_sent(
    client: TestClient, db: Session
) -> None:
    _, h = signed_in(db)
    assert client.get(API, headers=h).json()["profile"]["home_layout"] is None
    layout = {"order": ["goals", "plan", "habits", "plan"], "hidden": ["weather"]}
    r = client.patch(API, headers=h, json={"home_layout": layout})
    assert r.status_code == 200, r.text
    # Order kept as sent, duplicates dropped (first place wins).
    assert r.json()["home_layout"] == {
        "order": ["goals", "plan", "habits"],
        "hidden": ["weather"],
    }
    assert client.get(API, headers=h).json()["profile"]["home_layout"] == {
        "order": ["goals", "plan", "habits"],
        "hidden": ["weather"],
    }


def test_ids_this_server_does_not_know_are_kept(
    client: TestClient, db: Session
) -> None:
    # A newer phone's section must survive the round trip, not 422 the edit.
    _, h = signed_in(db)
    r = client.patch(
        API,
        headers=h,
        json={"home_layout": {"order": ["future_card", "goals"], "hidden": []}},
    )
    assert r.status_code == 200, r.text
    assert r.json()["home_layout"]["order"] == ["future_card", "goals"]


def test_null_and_other_fields_leave_the_layout_alone(
    client: TestClient, db: Session
) -> None:
    _, h = signed_in(db)
    layout = {"order": ["goals", "plan"], "hidden": ["mood"]}
    client.patch(API, headers=h, json={"home_layout": layout})
    assert (
        client.patch(API, headers=h, json={"home_layout": None}).json()["home_layout"]
        == layout
    )
    assert (
        client.patch(API, headers=h, json={"privacy_hidden": True}).json()[
            "home_layout"
        ]
        == layout
    )


def test_reset_is_a_layout_like_any_other(client: TestClient, db: Session) -> None:
    _, h = signed_in(db)
    client.patch(
        API, headers=h, json={"home_layout": {"order": ["goals"], "hidden": ["plan"]}}
    )
    reset = {"order": ["weekly_review", "yesterday", "plan"], "hidden": []}
    assert (
        client.patch(API, headers=h, json={"home_layout": reset}).json()["home_layout"]
        == reset
    )


def test_malformed_ids_are_refused(client: TestClient, db: Session) -> None:
    _, h = signed_in(db)
    for bad in (
        {"order": ["Goals"], "hidden": []},
        {"order": ["x" * 40], "hidden": []},
        {"order": [], "hidden": ["drop table"]},
        {"order": ["s"] * 65, "hidden": []},
    ):
        r = client.patch(API, headers=h, json={"home_layout": bad})
        assert r.status_code == 422, bad
    assert client.get(API, headers=h).json()["profile"]["home_layout"] is None


def test_layout_syncs_through_the_profile_entity(
    client: TestClient, db: Session
) -> None:
    _, h = signed_in(db)
    layout = {"order": ["goals", "tasks", "habits"], "hidden": ["launcher"]}
    op = {
        "op_id": str(uuid.uuid4()),
        "kind": "upsert",
        "name": "profile",
        "id": str(uuid.uuid4()),
        "data": {"home_layout": layout},
    }
    res = client.post(
        f"{settings.API_V1_STR}/sync/push", headers=h, json={"ops": [op]}
    ).json()["results"]
    assert [x["status"] for x in res] == ["applied"], res
    pulled = client.get(f"{settings.API_V1_STR}/sync/pull", headers=h).json()["changes"]
    row = next(c["row"] for c in pulled if c["entity"] == "profile")
    assert row["home_layout"] == layout
