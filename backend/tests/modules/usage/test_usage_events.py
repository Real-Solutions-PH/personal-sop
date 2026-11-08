"""Usage events: signed-in, batched, fixed vocabulary, owned by the caller."""

from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.core.config import settings
from app.modules.usage.models import UsageEvent
from tests.utils.mobile import signed_in

API = f"{settings.API_V1_STR}/usage/events"
AT = "2026-11-08T09:00:00+08:00"


def _rows(db: Session) -> list[UsageEvent]:
    db.expire_all()
    return list(db.exec(select(UsageEvent)).all())


def test_a_batch_is_stored_for_the_caller(client: TestClient, db: Session) -> None:
    user, h = signed_in(db)
    r = client.post(
        API,
        headers=h,
        json={
            "events": [
                {"kind": "app_open", "at": AT},
                {"kind": "share_card", "at": AT, "detail": "week-wrap"},
                {"kind": "app_close", "at": "2026-11-08T09:04:00+08:00"},
            ]
        },
    )
    assert r.status_code == 200, r.text
    assert r.json() == {"accepted": 3}
    rows = [x for x in _rows(db) if x.owner_id == user.id]
    assert sorted((x.kind, x.detail) for x in rows) == [
        ("app_close", None),
        ("app_open", None),
        ("share_card", "week-wrap"),
    ]
    assert {x.tenant_id for x in rows} == {user.tenant_id}


def test_signed_out_is_refused(client: TestClient, db: Session) -> None:
    before = len(_rows(db))
    r = client.post(API, json={"events": [{"kind": "app_open", "at": AT}]})
    assert r.status_code == 401
    assert len(_rows(db)) == before


def test_a_bad_event_refuses_the_whole_batch(client: TestClient, db: Session) -> None:
    user, h = signed_in(db)
    bad = [
        {"kind": "share_card", "at": AT},  # share without its card
        {"kind": "app_open", "at": AT, "detail": "x"},  # detail on an open
        {"kind": "app_open", "at": "2026-11-08T09:00:00"},  # no timezone
        {"kind": "share_card", "at": AT, "detail": "Has Spaces"},  # free text
        {"kind": "screen_view", "at": AT},  # unknown kind
    ]
    for e in bad:
        r = client.post(
            API,
            headers=h,
            json={"events": [{"kind": "app_open", "at": AT}, e]},
        )
        assert r.status_code == 422, (e, r.text)
    assert [x for x in _rows(db) if x.owner_id == user.id] == []


def test_batch_size_is_bounded(client: TestClient, db: Session) -> None:
    _, h = signed_in(db)
    assert client.post(API, headers=h, json={"events": []}).status_code == 422
    many = [{"kind": "app_open", "at": AT}] * 51
    assert client.post(API, headers=h, json={"events": many}).status_code == 422
