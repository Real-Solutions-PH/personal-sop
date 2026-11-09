"""The plan as the phone reads it: refresh from RevenueCat, the plan route,
the account payload and sync. The phone can never write it."""

import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

import pytest
from fastapi.testclient import TestClient
from pydantic import SecretStr
from sqlmodel import Session, select

from app.core.config import settings
from app.modules.billing import revenuecat
from app.modules.billing.models import Entitlement
from app.modules.usage.models import UsageEvent
from tests.utils.mobile import signed_in

API = settings.API_V1_STR
NOW = datetime.now(timezone.utc).replace(microsecond=0)


def _iso(d: datetime) -> str:
    return d.strftime("%Y-%m-%dT%H:%M:%SZ")


def _subscriber(
    expires: datetime | None, *, product: str = "plus_yearly", **sub: Any
) -> dict[str, Any]:
    """RevenueCat's GET /v1/subscribers/{id} response, trimmed to the parts
    the server reads."""
    exp = _iso(expires) if expires else None
    return {
        "subscriber": {
            "entitlements": {
                "plus": {
                    "expires_date": exp,
                    "product_identifier": product,
                    "purchase_date": _iso(NOW),
                }
            },
            "subscriptions": {
                product: {
                    "expires_date": exp,
                    "is_sandbox": True,
                    "unsubscribe_detected_at": None,
                    "refunded_at": None,
                    **sub,
                }
            },
        }
    }


@pytest.fixture
def rc(monkeypatch: pytest.MonkeyPatch) -> dict[str, Any]:
    """The one seam to RevenueCat's REST API."""
    state: dict[str, Any] = {"answer": None, "asked": []}

    def fake(app_user_id: str) -> dict[str, Any] | None:
        state["asked"].append(app_user_id)
        return state["answer"]  # type: ignore[no-any-return]

    monkeypatch.setattr(revenuecat, "fetch_subscriber", fake)
    monkeypatch.setattr(settings, "REVENUECAT_SECRET_API_KEY", SecretStr("sk_test"))
    return state


def _row(db: Session, owner: uuid.UUID) -> Entitlement | None:
    db.expire_all()
    return db.exec(select(Entitlement).where(Entitlement.owner_id == owner)).first()


def test_a_new_account_is_free(client: TestClient, db: Session) -> None:
    _, h = signed_in(db)
    r = client.get(f"{API}/billing/plan", headers=h)
    assert r.status_code == 200, r.text
    assert r.json() == {"plan": "free", "plus_until": None, "will_renew": False}
    me = client.get(f"{API}/users/me", headers=h).json()
    assert me["plan"] == "free" and me["plus_until"] is None


def test_refresh_writes_what_revenuecat_holds(
    client: TestClient, db: Session, rc: dict[str, Any]
) -> None:
    user, h = signed_in(db)
    until = NOW + timedelta(days=365)
    rc["answer"] = _subscriber(until)
    r = client.post(f"{API}/billing/refresh", headers=h)
    assert r.status_code == 200, r.text
    assert r.json() == {"plan": "plus", "plus_until": _iso_z(until), "will_renew": True}
    assert rc["asked"] == [str(user.id)]
    row = _row(db, user.id)
    assert row is not None and row.plan == "plus" and row.plus_until == until
    assert row.environment == "sandbox"
    me = client.get(f"{API}/users/me", headers=h).json()
    assert me["plan"] == "plus"


def _iso_z(d: datetime) -> str:
    return d.isoformat().replace("+00:00", "Z")


def test_refresh_after_cancel_keeps_plus_and_stops_renewing(
    client: TestClient, db: Session, rc: dict[str, Any]
) -> None:
    user, h = signed_in(db)
    rc["answer"] = _subscriber(
        NOW + timedelta(days=30), unsubscribe_detected_at=_iso(NOW)
    )
    body = client.post(f"{API}/billing/refresh", headers=h).json()
    assert body["plan"] == "plus" and body["will_renew"] is False


def test_refresh_with_no_entitlement_is_free(
    client: TestClient, db: Session, rc: dict[str, Any]
) -> None:
    user, h = signed_in(db)
    rc["answer"] = _subscriber(NOW + timedelta(days=30))
    client.post(f"{API}/billing/refresh", headers=h)
    rc["answer"] = {"subscriber": {"entitlements": {}, "subscriptions": {}}}
    body = client.post(f"{API}/billing/refresh", headers=h).json()
    assert body["plan"] == "free"
    row = _row(db, user.id)
    assert row is not None and row.plan == "free"


def test_refresh_with_an_expired_entitlement_is_free(
    client: TestClient, db: Session, rc: dict[str, Any]
) -> None:
    _, h = signed_in(db)
    rc["answer"] = _subscriber(NOW - timedelta(days=1))
    assert client.post(f"{API}/billing/refresh", headers=h).json()["plan"] == "free"


def test_refresh_without_a_key_changes_nothing(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(settings, "REVENUECAT_SECRET_API_KEY", None)
    called: list[str] = []

    def fake(uid: str) -> None:
        called.append(uid)

    monkeypatch.setattr(revenuecat, "fetch_subscriber", fake)
    user, h = signed_in(db)
    r = client.post(f"{API}/billing/refresh", headers=h)
    assert r.status_code == 200
    assert r.json()["plan"] == "free"
    assert called == []
    assert _row(db, user.id) is None


def test_refresh_when_revenuecat_is_unreachable_keeps_the_plan(
    client: TestClient, db: Session, rc: dict[str, Any]
) -> None:
    user, h = signed_in(db)
    rc["answer"] = _subscriber(NOW + timedelta(days=30))
    client.post(f"{API}/billing/refresh", headers=h)
    rc["answer"] = None  # the seam answers None when RevenueCat cannot be read
    body = client.post(f"{API}/billing/refresh", headers=h).json()
    assert body["plan"] == "plus"


def test_refresh_needs_a_session(client: TestClient) -> None:
    assert client.post(f"{API}/billing/refresh").status_code == 401
    assert client.get(f"{API}/billing/plan").status_code == 401


def test_the_plan_syncs_to_the_phone_and_the_phone_cannot_write_it(
    client: TestClient, db: Session, rc: dict[str, Any]
) -> None:
    user, h = signed_in(db)
    rc["answer"] = _subscriber(NOW + timedelta(days=30))
    client.post(f"{API}/billing/refresh", headers=h)
    pulled = client.get(f"{API}/sync/pull", headers=h).json()["changes"]
    rows = [c for c in pulled if c["entity"] == "entitlement"]
    assert len(rows) == 1
    assert rows[0]["row"]["plan"] == "plus"
    assert rows[0]["row"]["will_renew"] is True
    op = {
        "op_id": str(uuid.uuid4()),
        "kind": "upsert",
        "name": "entitlement",
        "id": rows[0]["id"],
        "data": {"plan": "plus", "plus_until": None},
    }
    res = client.post(f"{API}/sync/push", headers=h, json={"ops": [op]})
    statuses = [x["status"] for x in res.json().get("results", [])]
    assert res.status_code in (200, 422), res.text
    assert "applied" not in statuses
    row = _row(db, user.id)
    assert row is not None and row.plus_until is not None


def test_the_phone_logs_paywall_events_but_not_server_ones(
    client: TestClient, db: Session
) -> None:
    user, h = signed_in(db)
    at = "2026-11-09T09:00:00+08:00"
    ok = client.post(
        f"{API}/usage/events",
        headers=h,
        json={
            "events": [
                {"kind": "paywall_shown", "at": at},
                {"kind": "purchase_started", "at": at, "detail": "plus_yearly"},
                {"kind": "restored", "at": at},
            ]
        },
    )
    assert ok.status_code == 200, ok.text
    for kind in ("purchased", "cancelled", "refunded"):
        r = client.post(
            f"{API}/usage/events",
            headers=h,
            json={"events": [{"kind": kind, "at": at}]},
        )
        assert r.status_code == 422, kind
    db.expire_all()
    kinds = sorted(
        e.kind
        for e in db.exec(select(UsageEvent).where(UsageEvent.owner_id == user.id))
    )
    assert kinds == ["paywall_shown", "purchase_started", "restored"]


def test_export_stays_free(client: TestClient, db: Session) -> None:
    _, h = signed_in(db)
    r = client.get(f"{API}/users/me/export", headers=h)
    assert r.status_code == 200, r.text


def test_refresh_never_overwrites_news_that_landed_while_it_read(
    client: TestClient, db: Session, rc: dict[str, Any]
) -> None:
    """A refund webhook applied after the refresh began wins over the older
    snapshot the refresh read from RevenueCat."""
    user, h = signed_in(db)
    rc["answer"] = _subscriber(NOW + timedelta(days=30))
    client.post(f"{API}/billing/refresh", headers=h)
    row = _row(db, user.id)
    assert row is not None
    row.plan = "free"
    row.last_event_ms = int((NOW + timedelta(hours=1)).timestamp() * 1000)
    db.add(row)
    db.commit()
    body = client.post(f"{API}/billing/refresh", headers=h).json()
    assert body["plan"] == "free"


def test_refresh_of_a_refunded_purchase_is_free(
    client: TestClient, db: Session, rc: dict[str, Any]
) -> None:
    _, h = signed_in(db)
    rc["answer"] = _subscriber(NOW + timedelta(days=30), refunded_at=_iso(NOW))
    assert client.post(f"{API}/billing/refresh", headers=h).json()["plan"] == "free"


def test_refresh_of_a_sandbox_purchase_is_free_when_sandbox_is_off(
    client: TestClient,
    db: Session,
    rc: dict[str, Any],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "REVENUECAT_ALLOW_SANDBOX", False)
    _, h = signed_in(db)
    rc["answer"] = _subscriber(NOW + timedelta(days=30))
    assert client.post(f"{API}/billing/refresh", headers=h).json()["plan"] == "free"


def test_refresh_is_limited_per_person(
    client: TestClient, db: Session, rc: dict[str, Any], monkeypatch: pytest.MonkeyPatch
) -> None:
    from app.shared import rate_limit

    class Refuse:
        def allow(self, *_: object) -> bool:
            return False

    monkeypatch.setitem(rate_limit.guards, "account", Refuse())
    _, h = signed_in(db)
    assert client.post(f"{API}/billing/refresh", headers=h).status_code == 429
    assert rc["asked"] == []
