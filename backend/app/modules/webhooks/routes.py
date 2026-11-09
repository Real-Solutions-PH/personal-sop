import hmac
import json
import logging
from typing import Any

from fastapi import APIRouter, Header, Request
from pydantic import BaseModel
from starlette.concurrency import run_in_threadpool

from app.core.config import settings
from app.modules.billing import services as billing
from app.modules.webhooks import services, signature
from app.shared.deps import SessionDep
from app.shared.domain import domain_error

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/webhooks", tags=["webhooks"])

# RevenueCat retries a failed delivery for days: remember an applied event id
# for a week.
REVENUECAT_SEEN_TTL = 7 * 24 * 3600


class WebhookAck(BaseModel):
    result: str


@router.post("/supabase-auth", response_model=WebhookAck)
async def supabase_auth_event(
    request: Request,
    session: SessionDep,
    webhook_id: str | None = Header(default=None, alias="webhook-id"),
    webhook_timestamp: str | None = Header(default=None, alias="webhook-timestamp"),
    webhook_signature: str | None = Header(default=None, alias="webhook-signature"),
) -> WebhookAck:
    """No bearer token: the Standard Webhooks signature is the credential."""
    secret = settings.SUPABASE_AUTH_HOOK_SECRET
    if secret is None:
        raise domain_error(404, "not_found", "Not found")
    body = await request.body()
    try:
        signature.verify(
            secret.get_secret_value(),
            msg_id=webhook_id,
            timestamp=webhook_timestamp,
            signature=webhook_signature,
            body=body,
        )
    except signature.InvalidSignature as exc:
        raise domain_error(401, "invalid_signature", "Signature check failed") from exc
    assert webhook_id is not None
    # Redis and the database are synchronous: keep them off the event loop.
    if not await run_in_threadpool(services.first_delivery, webhook_id):
        return WebhookAck(result="duplicate")
    try:
        event: dict[str, Any] = json.loads(body)
    except ValueError as exc:
        raise domain_error(422, "invalid_payload", "Body is not JSON") from exc
    if not isinstance(event, dict):
        raise domain_error(422, "invalid_payload", "Body is not an object")
    result = await run_in_threadpool(services.handle_auth_event, session, event)
    logger.info("supabase auth webhook handled", extra={"result": result})
    return WebhookAck(result=result)


@router.post("/revenuecat", response_model=WebhookAck)
async def revenuecat_event(
    request: Request,
    session: SessionDep,
    authorization: str | None = Header(default=None),
) -> WebhookAck:
    """RevenueCat sends the Authorization header value set in its dashboard;
    that shared secret is the credential (compared in constant time)."""
    secret = settings.REVENUECAT_WEBHOOK_AUTH
    if secret is None:
        raise domain_error(404, "not_found", "Not found")
    expected = secret.get_secret_value().encode()
    if not authorization or not hmac.compare_digest(authorization.encode(), expected):
        raise domain_error(401, "invalid_signature", "Signature check failed")
    body = await request.body()
    try:
        payload: Any = json.loads(body)
    except ValueError as exc:
        raise domain_error(422, "invalid_payload", "Body is not JSON") from exc
    event = payload.get("event") if isinstance(payload, dict) else None
    if not isinstance(event, dict) or not isinstance(event.get("id"), str):
        raise domain_error(422, "invalid_payload", "No event")
    # Redis and the database are synchronous: keep them off the event loop.
    key = f"revenuecat:{event['id']}"
    if not await run_in_threadpool(services.first_delivery, key, REVENUECAT_SEEN_TTL):
        return WebhookAck(result="duplicate")
    try:
        result = await run_in_threadpool(billing.apply_event, session, payload)
    except billing.InvalidEvent as exc:
        await run_in_threadpool(services.forget_delivery, key)
        raise domain_error(422, "invalid_payload", "Not a usable event") from exc
    except Exception:
        # Let RevenueCat's retry apply it: it must not read as a duplicate.
        await run_in_threadpool(services.forget_delivery, key)
        raise
    logger.info(
        "revenuecat webhook handled",
        extra={"result": result, "type": str(event.get("type"))[:40]},
    )
    return WebhookAck(result=result)
