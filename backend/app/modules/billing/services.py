"""RevenueCat news -> the account's plan.

Two writers, both server-side: ``apply_event`` for a verified webhook and
``refresh`` for what RevenueCat's REST API holds now (the app asks for it on
start and right after a purchase or a restore). The phone never says what
its plan is.

Event handling (RevenueCat webhook ``type``):

- a purchase, renewal, un-cancel, product change, extension or a reversed
  refund: Plus until ``expiration_at_ms`` (none: no end), renewing;
- ``CANCELLATION``: renewal is off and Plus runs to the end of the paid
  period; with ``cancel_reason`` ``CUSTOMER_SUPPORT`` it is a refund, and
  the plan is free from the moment of the event (only when the refunded
  product is the one held: an upgrade can refund the old one);
- ``EXPIRATION``: free;
- ``BILLING_ISSUE`` with a grace period: Plus runs to the grace period's end;
- ``TRANSFER``: the purchase moved to another account (a restore on a
  different sign-in): every account on either side is refreshed from
  RevenueCat; without the API key, the accounts it left are free;
- anything else (``TEST``, Android-only pauses, types added later) changes
  nothing.

News older than the newest already applied is "stale": it changes no plan,
though the usage event it stands for is still logged.
"""

import logging
import uuid
from datetime import datetime, timezone
from typing import Any

from sqlalchemy.dialects.postgresql import insert
from sqlmodel import Session, select

from app.core.config import settings
from app.modules.billing import revenuecat
from app.modules.billing.models import Entitlement
from app.modules.billing.schema import PlanPublic
from app.modules.iam.users.models import User
from app.modules.usage.models import UsageEvent
from app.shared.owned import utcnow

logger = logging.getLogger(__name__)

PRODUCTS = ("plus_monthly", "plus_yearly")

GRANTS = frozenset(
    {
        "INITIAL_PURCHASE",
        "RENEWAL",
        "UNCANCELLATION",
        "PRODUCT_CHANGE",
        "SUBSCRIPTION_EXTENDED",
        "NON_RENEWING_PURCHASE",
        "TEMPORARY_ENTITLEMENT_GRANT",
        "REFUND_REVERSED",
    }
)
REFUND_REASON = "CUSTOMER_SUPPORT"


class InvalidEvent(ValueError):
    pass


# ------------------------------------------------------------------ reads


def _row(session: Session, owner_id: uuid.UUID) -> Entitlement | None:
    return session.exec(
        select(Entitlement).where(Entitlement.owner_id == owner_id)
    ).first()


def in_force(row: Entitlement | None, now: datetime) -> bool:
    """Plus counts while the stored plan is Plus and its end is not past."""
    if row is None or row.plan != "plus":
        return False
    return row.plus_until is None or row.plus_until > now


def view(
    session: Session, owner_id: uuid.UUID, now: datetime | None = None
) -> PlanPublic:
    row = _row(session, owner_id)
    plus = in_force(row, now or utcnow())
    return PlanPublic(
        plan="plus" if plus else "free",
        plus_until=row.plus_until if row and row.plan == "plus" else None,
        will_renew=bool(plus and row and row.will_renew),
    )


# ----------------------------------------------------------------- writes


def _locked_row(session: Session, user: User) -> Entitlement:
    """The person's row, created if missing, locked for this transaction
    so two deliveries for one person apply one after the other."""
    session.exec(
        insert(Entitlement)
        .values(
            id=uuid.uuid4(),
            owner_id=user.id,
            tenant_id=user.tenant_id,
            created_at=utcnow(),
            updated_at=utcnow(),
        )
        .on_conflict_do_nothing(index_elements=["owner_id"])
    )
    row = session.exec(
        select(Entitlement).where(Entitlement.owner_id == user.id).with_for_update()
    ).one()
    session.refresh(row)
    return row


def _ms_to_dt(value: Any) -> datetime | None:
    if isinstance(value, bool) or not isinstance(value, int | float):
        return None
    return datetime.fromtimestamp(value / 1000, tz=timezone.utc)


def _iso_to_dt(value: Any) -> datetime | None:
    if not isinstance(value, str) or not value:
        return None
    try:
        d = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    return d if d.tzinfo else d.replace(tzinfo=timezone.utc)


def _account(session: Session, event: dict[str, Any]) -> User | None:
    """The first id RevenueCat knows this customer by that is one of our
    accounts (the app signs in to RevenueCat with the account id)."""
    ids: list[Any] = [event.get("app_user_id"), event.get("original_app_user_id")]
    aliases = event.get("aliases")
    if isinstance(aliases, list):
        ids.extend(aliases)
    for raw in ids:
        if not isinstance(raw, str):
            continue
        try:
            uid = uuid.UUID(raw)
        except ValueError:
            continue
        user = session.get(User, uid)
        if user is not None:
            return user
    return None


def _ours(event: dict[str, Any]) -> bool:
    ents = event.get("entitlement_ids")
    if isinstance(ents, list):
        return settings.REVENUECAT_ENTITLEMENT_ID in ents
    return event.get("product_id") in PRODUCTS


def _product_key(event: dict[str, Any]) -> str | None:
    p = event.get("product_id")
    return p if p in PRODUCTS else None


def _log(
    session: Session, user: User, kind: str, at: datetime, product: str | None
) -> None:
    session.add(
        UsageEvent(
            owner_id=user.id,
            tenant_id=user.tenant_id,
            kind=kind,
            at=at,
            detail=product,
        )
    )


def _environment(raw: Any) -> str:
    return "sandbox" if str(raw).upper() == "SANDBOX" else "production"


def _touch(row: Entitlement) -> None:
    row.updated_at = utcnow()


def apply_event(session: Session, body: Any) -> str:
    """One verified webhook body. Returns what happened, for the reply and
    the log; commits its own transaction."""
    event = body.get("event") if isinstance(body, dict) else None
    if not isinstance(event, dict) or not isinstance(event.get("type"), str):
        raise InvalidEvent("no event")
    kind = event["type"].upper()
    if kind == "TEST":
        return "test"
    if kind == "TRANSFER":
        if (
            _environment(event.get("environment")) == "sandbox"
            and not settings.REVENUECAT_ALLOW_SANDBOX
        ):
            return "ignored"
        return _transfer(session, event)
    grace = _ms_to_dt(event.get("grace_period_expiration_at_ms"))
    if kind == "BILLING_ISSUE" and grace is None:
        return "ignored"
    if kind not in GRANTS and kind not in (
        "CANCELLATION",
        "EXPIRATION",
        "BILLING_ISSUE",
    ):
        return "ignored"
    if not _ours(event):
        return "ignored"
    environment = _environment(event.get("environment"))
    if environment == "sandbox" and not settings.REVENUECAT_ALLOW_SANDBOX:
        return "ignored"
    user = _account(session, event)
    if user is None:
        return "unknown_user"
    at_ms = event.get("event_timestamp_ms")
    if isinstance(at_ms, bool) or not isinstance(at_ms, int):
        raise InvalidEvent("no event_timestamp_ms")
    at = _ms_to_dt(at_ms)
    assert at is not None
    product = _product_key(event)
    if kind == "PRODUCT_CHANGE":
        # RevenueCat names the product left in product_id.
        product = _product_key({"product_id": event.get("new_product_id")}) or product
    refund = kind == "CANCELLATION" and event.get("cancel_reason") == REFUND_REASON

    usage = {
        "INITIAL_PURCHASE": "purchased",
        "CANCELLATION": "refunded" if refund else "cancelled",
    }.get(kind)
    if usage:
        _log(session, user, usage, at, product)

    row = _locked_row(session, user)
    if row.last_event_ms is not None and at_ms < row.last_event_ms:
        session.commit()
        return "stale"
    expires = _ms_to_dt(event.get("expiration_at_ms"))
    other_product = bool(row.product_id and product and product != row.product_id)
    if kind == "BILLING_ISSUE":
        row.plus_until = grace
    elif refund and other_product:
        # A refund of a product the account no longer holds (the monthly
        # left behind by an upgrade): the plan held stands.
        session.commit()
        return "ignored"
    elif kind in GRANTS:
        row.plan = "plus"
        row.plus_until = expires
        row.will_renew = kind != "NON_RENEWING_PURCHASE"
    elif refund:
        row.plan = "free"
        row.plus_until = at
        row.will_renew = False
    elif kind == "CANCELLATION":
        row.will_renew = False
        if expires is not None:
            row.plus_until = expires
    else:  # EXPIRATION
        row.plan = "free"
        row.will_renew = False
        if expires is not None:
            row.plus_until = expires
    if product and kind != "BILLING_ISSUE":
        row.product_id = product
    row.environment = environment
    row.last_event_ms = at_ms
    _touch(row)
    session.add(row)
    session.commit()
    return "applied"


def _transfer(session: Session, event: dict[str, Any]) -> str:
    now = utcnow()
    now_ms = int(now.timestamp() * 1000)
    touched = False
    for field, leaving in (("transferred_from", True), ("transferred_to", False)):
        ids = event.get(field)
        if not isinstance(ids, list):
            continue
        for raw in ids:
            user = _account(session, {"app_user_id": raw})
            if user is None:
                continue
            # RevenueCat says what each side holds after the move; the account
            # left may still hold Plus through another purchase.
            if not _refresh_user(session, user, now) and leaving:
                row = _locked_row(session, user)
                row.plan = "free"
                row.will_renew = False
                row.plus_until = now
                row.last_event_ms = now_ms
                _touch(row)
                session.add(row)
                session.commit()
            touched = True
    return "applied" if touched else "unknown_user"


def _from_subscriber(row: Entitlement, body: dict[str, Any], now: datetime) -> None:
    sub = body.get("subscriber")
    sub = sub if isinstance(sub, dict) else {}
    ents = sub.get("entitlements")
    ent = (
        ents.get(settings.REVENUECAT_ENTITLEMENT_ID) if isinstance(ents, dict) else None
    )
    subs = sub.get("subscriptions")
    product = ent.get("product_identifier") if isinstance(ent, dict) else None
    detail = (
        subs.get(product)
        if isinstance(subs, dict) and isinstance(product, str)
        else None
    )
    detail = detail if isinstance(detail, dict) else {}
    sandbox = bool(detail.get("is_sandbox"))
    if not isinstance(ent, dict) or (sandbox and not settings.REVENUECAT_ALLOW_SANDBOX):
        row.plan = "free"
        row.will_renew = False
        return
    expires = _iso_to_dt(ent.get("expires_date"))
    refunded = _iso_to_dt(detail.get("refunded_at"))
    if refunded is not None:
        row.plan = "free"
        row.plus_until = refunded
        row.will_renew = False
    else:
        active = expires is None or expires > now
        row.plan = "plus" if active else "free"
        row.plus_until = expires
        row.will_renew = active and not detail.get("unsubscribe_detected_at")
    if product in PRODUCTS:
        row.product_id = product
    row.environment = "sandbox" if sandbox else "production"


def _refresh_user(session: Session, user: User, now: datetime) -> bool:
    if settings.REVENUECAT_SECRET_API_KEY is None:
        return False
    body = revenuecat.fetch_subscriber(str(user.id))
    if body is None:
        return False
    now_ms = int(now.timestamp() * 1000)
    row = _locked_row(session, user)
    if row.last_event_ms is not None and row.last_event_ms > now_ms:
        # A webhook landed while RevenueCat was being read: it is newer than
        # the snapshot read, so it stands.
        session.commit()
        return True
    _from_subscriber(row, body, now)
    # What RevenueCat holds now outranks any news dated before this moment.
    row.last_event_ms = max(row.last_event_ms or 0, now_ms)
    _touch(row)
    session.add(row)
    session.commit()
    return True


def refresh(session: Session, user: User) -> PlanPublic:
    """Ask RevenueCat for this account and store the answer; without a key,
    or when RevenueCat cannot be read, the stored plan stands."""
    now = utcnow()
    _refresh_user(session, user, now)
    session.expire_all()
    return view(session, user.id, now)


def plan_of(session: Session, owner_id: uuid.UUID, now: datetime | None = None) -> str:
    return view(session, owner_id, now).plan
