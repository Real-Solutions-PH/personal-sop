import json
import logging
from typing import Any

from fastapi import APIRouter, Header, Request
from pydantic import BaseModel
from starlette.concurrency import run_in_threadpool

from app.core.config import settings
from app.modules.webhooks import services, signature
from app.shared.deps import SessionDep
from app.shared.domain import domain_error

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/webhooks", tags=["webhooks"])


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
