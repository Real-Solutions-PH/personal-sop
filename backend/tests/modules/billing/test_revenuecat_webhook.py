"""RevenueCat webhooks -> the account's plan.

Payloads follow RevenueCat's documented webhook shape: ``{"api_version":
"1.0", "event": {...}}`` with the event's ``id``, ``type``, ``app_user_id``,
``aliases``, ``entitlement_ids``, ``product_id``, ``environment``,
``event_timestamp_ms`` and ``expiration_at_ms``; a refund is a
``CANCELLATION`` whose ``cancel_reason`` is ``CUSTOMER_SUPPORT``.
"""

import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

import pytest
from fastapi.testclient import TestClient
from pydantic import SecretStr
from sqlmodel import Session, select

from app.core.config import settings
from app.modules.billing import public
from app.modules.billing.models import Entitlement
from app.modules.iam.users.models import User
from app.modules.usage.models import UsageEvent
from tests.utils.user import create_random_user

URL = f"{settings.API_V1_STR}/webhooks/revenuecat"
AUTH = "Bearer rc-test-webhook-auth"


@pytest.fixture(autouse=True)
def webhook_auth(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "REVENUECAT_WEBHOOK_AUTH", SecretStr(AUTH))
    monkeypatch.setattr(settings, "REVENUECAT_ALLOW_SANDBOX", True)


def _ms(d: datetime) -> int:
    return int(d.timestamp() * 1000)


NOW = datetime.now(timezone.utc).replace(microsecond=0)


def _event(user: User | str, kind: str, **over: Any) -> dict[str, Any]:
    uid = str(user.id) if isinstance(user, User) else user
    ev: dict[str, Any] = {
        "id": str(uuid.uuid4()).upper(),
        "type": kind,
        "app_user_id": uid,
        "original_app_user_id": uid,
        "aliases": [uid],
        "entitlement_ids": ["plus"],
        "product_id": "plus_yearly",
        "environment": "SANDBOX",
        "store": "APP_STORE",
        "event_timestamp_ms": _ms(NOW),
        "purchased_at_ms": _ms(NOW),
        "expiration_at_ms": _ms(NOW + timedelta(days=365)),
    }
    ev.update(over)
    return {"api_version": "1.0", "event": ev}


def _send(client: TestClient, body: dict[str, Any], auth: str | None = AUTH) -> Any:
    headers = {"Authorization": auth} if auth is not None else {}
    return client.post(URL, json=body, headers=headers)


def _row(db: Session, user: User) -> Entitlement | None:
    db.expire_all()
    return db.exec(select(Entitlement).where(Entitlement.owner_id == user.id)).first()


def _usage(db: Session, user: User) -> list[str]:
    db.expire_all()
    rows = db.exec(select(UsageEvent).where(UsageEvent.owner_id == user.id)).all()
    return sorted(r.kind for r in rows)


def _plan(db: Session, user: User, at: datetime | None = None) -> str:
    db.expire_all()
    return public.plan_of(db, user.id, now=at)


def test_a_yearly_purchase_turns_the_plan_to_plus(
    client: TestClient, db: Session
) -> None:
    user = create_random_user(db)
    r = _send(client, _event(user, "INITIAL_PURCHASE"))
    assert r.status_code == 200, r.text
    assert r.json() == {"result": "applied"}
    row = _row(db, user)
    assert row is not None
    assert row.plan == "plus"
    assert row.plus_until == NOW + timedelta(days=365)
    assert row.will_renew is True
    assert row.product_id == "plus_yearly"
    assert row.environment == "sandbox"
    assert row.tenant_id == user.tenant_id
    assert _plan(db, user) == "plus"
    assert _usage(db, user) == ["purchased"]


def test_a_renewal_moves_plus_until_on(client: TestClient, db: Session) -> None:
    user = create_random_user(db)
    _send(client, _event(user, "INITIAL_PURCHASE"))
    later = NOW + timedelta(days=365)
    r = _send(
        client,
        _event(
            user,
            "RENEWAL",
            event_timestamp_ms=_ms(later),
            expiration_at_ms=_ms(later + timedelta(days=365)),
        ),
    )
    assert r.json() == {"result": "applied"}
    row = _row(db, user)
    assert row is not None and row.plan == "plus"
    assert row.plus_until == later + timedelta(days=365)
    # A renewal is not a new purchase.
    assert _usage(db, user) == ["purchased"]


def test_a_cancellation_keeps_plus_until_it_runs_out(
    client: TestClient, db: Session
) -> None:
    user = create_random_user(db)
    _send(client, _event(user, "INITIAL_PURCHASE"))
    until = NOW + timedelta(days=365)
    r = _send(
        client,
        _event(
            user,
            "CANCELLATION",
            cancel_reason="UNSUBSCRIBE",
            event_timestamp_ms=_ms(NOW + timedelta(days=3)),
        ),
    )
    assert r.json() == {"result": "applied"}
    row = _row(db, user)
    assert row is not None
    assert row.plan == "plus" and row.will_renew is False
    assert row.plus_until == until
    assert _plan(db, user) == "plus"
    # Once plus_until passes the account is free again with no further event.
    assert _plan(db, user, at=until + timedelta(seconds=1)) == "free"
    assert _usage(db, user) == ["cancelled", "purchased"]


def test_a_refund_returns_the_plan_to_free_at_once(
    client: TestClient, db: Session
) -> None:
    user = create_random_user(db)
    _send(client, _event(user, "INITIAL_PURCHASE"))
    refunded = NOW + timedelta(days=2)
    r = _send(
        client,
        _event(
            user,
            "CANCELLATION",
            cancel_reason="CUSTOMER_SUPPORT",
            event_timestamp_ms=_ms(refunded),
            # RevenueCat still names the period's end; the refund wins.
            expiration_at_ms=_ms(NOW + timedelta(days=365)),
        ),
    )
    assert r.json() == {"result": "applied"}
    row = _row(db, user)
    assert row is not None
    assert row.plan == "free" and row.will_renew is False
    assert row.plus_until == refunded
    assert _plan(db, user) == "free"
    assert _usage(db, user) == ["purchased", "refunded"]


def test_an_expiration_returns_the_plan_to_free(
    client: TestClient, db: Session
) -> None:
    user = create_random_user(db)
    _send(client, _event(user, "INITIAL_PURCHASE"))
    end = NOW + timedelta(days=365)
    r = _send(
        client,
        _event(
            user, "EXPIRATION", event_timestamp_ms=_ms(end), expiration_at_ms=_ms(end)
        ),
    )
    assert r.json() == {"result": "applied"}
    row = _row(db, user)
    assert row is not None and row.plan == "free"
    assert _plan(db, user) == "free"


@pytest.mark.parametrize("auth", [None, "", "Bearer wrong", AUTH + "x", AUTH[:-1]])
def test_a_forged_webhook_is_refused_with_no_change(
    client: TestClient, db: Session, auth: str | None
) -> None:
    user = create_random_user(db)
    r = _send(client, _event(user, "INITIAL_PURCHASE"), auth=auth)
    assert r.status_code == 401, r.text
    assert _row(db, user) is None
    assert _usage(db, user) == []


def test_the_route_is_absent_until_the_secret_is_set(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(settings, "REVENUECAT_WEBHOOK_AUTH", None)
    user = create_random_user(db)
    r = _send(client, _event(user, "INITIAL_PURCHASE"))
    assert r.status_code == 404
    assert _row(db, user) is None


def test_a_redelivered_event_is_applied_once(client: TestClient, db: Session) -> None:
    user = create_random_user(db)
    body = _event(user, "INITIAL_PURCHASE")
    assert _send(client, body).json() == {"result": "applied"}
    assert _send(client, body).json() == {"result": "duplicate"}
    assert _usage(db, user) == ["purchased"]


def test_an_older_event_never_winds_the_plan_back(
    client: TestClient, db: Session
) -> None:
    user = create_random_user(db)
    _send(
        client,
        _event(user, "RENEWAL", event_timestamp_ms=_ms(NOW + timedelta(days=1))),
    )
    stale = _event(
        user,
        "EXPIRATION",
        event_timestamp_ms=_ms(NOW - timedelta(days=1)),
        expiration_at_ms=_ms(NOW - timedelta(days=1)),
    )
    assert _send(client, stale).json() == {"result": "stale"}
    row = _row(db, user)
    assert row is not None and row.plan == "plus"


@pytest.mark.parametrize(
    "app_user_id",
    ["$RCAnonymousID:8b1f2c", str(uuid.uuid4()), "not-a-uuid"],
)
def test_an_event_for_no_known_account_changes_nothing(
    client: TestClient, db: Session, app_user_id: str
) -> None:
    before = len(db.exec(select(Entitlement)).all())
    body = _event(app_user_id, "INITIAL_PURCHASE")
    r = _send(client, body)
    assert r.status_code == 200
    assert r.json() == {"result": "unknown_user"}
    db.expire_all()
    assert len(db.exec(select(Entitlement)).all()) == before


def test_an_alias_names_the_account(client: TestClient, db: Session) -> None:
    user = create_random_user(db)
    body = _event("$RCAnonymousID:abc", "INITIAL_PURCHASE")
    body["event"]["aliases"] = ["$RCAnonymousID:abc", str(user.id)]
    assert _send(client, body).json() == {"result": "applied"}
    row = _row(db, user)
    assert row is not None and row.plan == "plus"


@pytest.mark.parametrize("kind", ["TEST", "SUBSCRIPTION_PAUSED", "SOMETHING_NEW"])
def test_test_and_unknown_events_change_nothing(
    client: TestClient, db: Session, kind: str
) -> None:
    user = create_random_user(db)
    r = _send(client, _event(user, kind))
    assert r.status_code == 200
    assert r.json()["result"] in {"test", "ignored"}
    assert _row(db, user) is None
    assert _usage(db, user) == []


def test_another_entitlement_is_ignored(client: TestClient, db: Session) -> None:
    user = create_random_user(db)
    body = _event(user, "INITIAL_PURCHASE", entitlement_ids=["something_else"])
    body["event"]["product_id"] = "other_product"
    assert _send(client, body).json() == {"result": "ignored"}
    assert _row(db, user) is None


def test_sandbox_events_are_ignored_when_sandbox_is_off(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(settings, "REVENUECAT_ALLOW_SANDBOX", False)
    user = create_random_user(db)
    assert _send(client, _event(user, "INITIAL_PURCHASE")).json() == {
        "result": "ignored"
    }
    assert _row(db, user) is None
    r = _send(client, _event(user, "INITIAL_PURCHASE", environment="PRODUCTION"))
    assert r.json() == {"result": "applied"}


def test_a_malformed_body_is_refused(client: TestClient) -> None:
    r = client.post(URL, content=b"not json", headers={"Authorization": AUTH})
    assert r.status_code == 422
    r = client.post(URL, json={"api_version": "1.0"}, headers={"Authorization": AUTH})
    assert r.status_code == 422


def test_a_billing_issue_keeps_plus_through_the_grace_period(
    client: TestClient, db: Session
) -> None:
    user = create_random_user(db)
    _send(client, _event(user, "INITIAL_PURCHASE"))
    grace = NOW + timedelta(days=381)
    r = _send(
        client,
        _event(
            user,
            "BILLING_ISSUE",
            event_timestamp_ms=_ms(NOW + timedelta(days=365)),
            grace_period_expiration_at_ms=_ms(grace),
        ),
    )
    assert r.json() == {"result": "applied"}
    row = _row(db, user)
    assert row is not None and row.plan == "plus"
    assert row.plus_until == grace
    assert _plan(db, user, at=NOW + timedelta(days=370)) == "plus"


def test_a_billing_issue_without_grace_changes_nothing(
    client: TestClient, db: Session
) -> None:
    user = create_random_user(db)
    _send(client, _event(user, "INITIAL_PURCHASE"))
    body = _event(user, "BILLING_ISSUE", event_timestamp_ms=_ms(NOW + timedelta(1)))
    assert _send(client, body).json() == {"result": "ignored"}
    row = _row(db, user)
    assert row is not None and row.plus_until == NOW + timedelta(days=365)


def test_a_product_change_stores_the_new_product(
    client: TestClient, db: Session
) -> None:
    user = create_random_user(db)
    _send(client, _event(user, "INITIAL_PURCHASE", product_id="plus_monthly"))
    _send(
        client,
        _event(
            user,
            "PRODUCT_CHANGE",
            product_id="plus_monthly",
            new_product_id="plus_yearly",
            event_timestamp_ms=_ms(NOW + timedelta(days=1)),
        ),
    )
    row = _row(db, user)
    assert row is not None and row.product_id == "plus_yearly"


def test_a_refund_of_a_product_no_longer_held_keeps_plus(
    client: TestClient, db: Session
) -> None:
    """An upgrade from monthly to yearly can refund the old monthly
    transaction; the yearly Plus stays."""
    user = create_random_user(db)
    _send(client, _event(user, "INITIAL_PURCHASE", product_id="plus_yearly"))
    r = _send(
        client,
        _event(
            user,
            "CANCELLATION",
            product_id="plus_monthly",
            cancel_reason="CUSTOMER_SUPPORT",
            event_timestamp_ms=_ms(NOW + timedelta(days=1)),
        ),
    )
    assert r.status_code == 200
    row = _row(db, user)
    assert row is not None and row.plan == "plus"
    assert row.product_id == "plus_yearly"
    assert _plan(db, user) == "plus"


def _transfer(src: User, dst: User, **over: Any) -> dict[str, Any]:
    ev: dict[str, Any] = {
        "id": str(uuid.uuid4()),
        "type": "TRANSFER",
        "transferred_from": [str(src.id)],
        "transferred_to": [str(dst.id)],
        "environment": "SANDBOX",
        "event_timestamp_ms": _ms(NOW + timedelta(days=2)),
    }
    ev.update(over)
    return {"api_version": "1.0", "event": ev}


def _rc_answers(
    monkeypatch: pytest.MonkeyPatch, answers: dict[str, dict[str, Any]]
) -> None:
    from app.modules.billing import revenuecat

    monkeypatch.setattr(settings, "REVENUECAT_SECRET_API_KEY", SecretStr("sk_t"))
    monkeypatch.setattr(revenuecat, "fetch_subscriber", lambda uid: answers.get(uid))


def _active() -> dict[str, Any]:
    exp = (NOW + timedelta(days=300)).strftime("%Y-%m-%dT%H:%M:%SZ")
    return {
        "subscriber": {
            "entitlements": {
                "plus": {"expires_date": exp, "product_identifier": "plus_yearly"}
            },
            "subscriptions": {"plus_yearly": {"expires_date": exp, "is_sandbox": True}},
        }
    }


def test_a_transfer_moves_plus_by_asking_revenuecat_for_both_accounts(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    src, dst = create_random_user(db), create_random_user(db)
    _send(client, _event(src, "INITIAL_PURCHASE"))
    empty: dict[str, Any] = {"subscriber": {"entitlements": {}, "subscriptions": {}}}
    _rc_answers(monkeypatch, {str(src.id): empty, str(dst.id): _active()})
    assert _send(client, _transfer(src, dst)).json() == {"result": "applied"}
    assert _plan(db, src) == "free"
    assert _plan(db, dst) == "plus"


def test_a_transfer_away_from_an_account_that_still_holds_plus_keeps_it(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    src, dst = create_random_user(db), create_random_user(db)
    _send(client, _event(src, "INITIAL_PURCHASE"))
    _rc_answers(monkeypatch, {str(src.id): _active(), str(dst.id): _active()})
    _send(client, _transfer(src, dst))
    assert _plan(db, src) == "plus"


def test_a_transfer_without_a_key_frees_the_account_it_left(
    client: TestClient, db: Session
) -> None:
    src, dst = create_random_user(db), create_random_user(db)
    _send(client, _event(src, "INITIAL_PURCHASE"))
    assert _send(client, _transfer(src, dst)).json() == {"result": "applied"}
    assert _plan(db, src) == "free"
    assert _plan(db, dst) == "free"


def test_a_sandbox_transfer_is_ignored_when_sandbox_is_off(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    src, dst = create_random_user(db), create_random_user(db)
    _send(client, _event(src, "INITIAL_PURCHASE", environment="PRODUCTION"))
    monkeypatch.setattr(settings, "REVENUECAT_ALLOW_SANDBOX", False)
    assert _send(client, _transfer(src, dst)).json() == {"result": "ignored"}
    assert _plan(db, src) == "plus"
