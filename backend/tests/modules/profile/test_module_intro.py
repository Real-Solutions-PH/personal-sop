"""The one-time reintroduction of a hidden module: which ones were offered
(by Fern, once) and which the person turned down for good ("Not for me").
Both are on the account, so they survive a reinstall, and only grow: a
device that knows less never takes one back."""

from fastapi.testclient import TestClient
from sqlmodel import Session

from app.core.config import settings
from tests.utils.mobile import signed_in

API = f"{settings.API_V1_STR}/profile"


def test_empty_until_set(client: TestClient, db: Session) -> None:
    _, h = signed_in(db)
    p = client.get(API, headers=h).json()["profile"]
    assert (p["intro_offered"], p["intro_dismissed"]) == ([], [])


def test_dismissed_only_grows(client: TestClient, db: Session) -> None:
    _, h = signed_in(db)
    r = client.patch(API, headers=h, json={"intro_dismissed": ["journal"]})
    assert r.status_code == 200, r.text
    r = client.patch(API, headers=h, json={"intro_dismissed": ["finance"]})
    assert r.json()["intro_dismissed"] == ["finance", "journal"]
    # A device that never saw the first dismissal sends an empty list.
    r = client.patch(API, headers=h, json={"intro_dismissed": []})
    assert r.json()["intro_dismissed"] == ["finance", "journal"]
    r = client.patch(API, headers=h, json={"intro_offered": ["social"]})
    assert r.json()["intro_offered"] == ["social"]


def test_an_unknown_part_is_refused(client: TestClient, db: Session) -> None:
    _, h = signed_in(db)
    r = client.patch(API, headers=h, json={"intro_dismissed": ["weather"]})
    assert r.status_code == 422
