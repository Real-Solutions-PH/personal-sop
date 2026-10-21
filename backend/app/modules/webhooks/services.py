"""Supabase auth events -> the local user mirror.

Wired as a Supabase Database Webhook on ``auth.users`` (INSERT, UPDATE,
DELETE) pointing at ``POST /webhooks/supabase-auth``, signed with
``SUPABASE_AUTH_HOOK_SECRET``.

- DELETE: the identity is gone, so erase the local user and, by FK cascade,
  every row of theirs in every module (GDPR erasure path, audited).
- INSERT / UPDATE: mirror the email; just-in-time provisioning on the first
  request still creates the row, so a missed INSERT costs nothing.
"""

import uuid
from typing import Any

import redis
from redis.exceptions import RedisError
from sqlmodel import Session

from app.core.config import settings
from app.modules.audit import services as audit
from app.modules.iam.users import repo as user_repo
from app.shared.domain import domain_error

SEEN_TTL_SECONDS = 600

_redis: redis.Redis | None = None


def _client() -> redis.Redis:
    global _redis
    if _redis is None:
        _redis = redis.Redis.from_url(settings.REDIS_URL, decode_responses=True)
    return _redis


def first_delivery(msg_id: str) -> bool:
    """True the first time a webhook id is seen (replay guard). Fails closed:
    without the guard an event is refused and the sender retries."""
    try:
        return bool(
            _client().set(f"webhook:seen:{msg_id}", "1", nx=True, ex=SEEN_TTL_SECONDS)
        )
    except RedisError as exc:
        raise domain_error(503, "webhook_unavailable", "Try again later") from exc


def handle_auth_event(session: Session, event: dict[str, Any]) -> str:
    kind = str(event.get("type", "")).upper()
    if event.get("schema") != "auth" or event.get("table") != "users":
        return "ignored"
    record = event.get("old_record") if kind == "DELETE" else event.get("record")
    if not isinstance(record, dict):
        return "ignored"
    try:
        user_id = uuid.UUID(str(record.get("id")))
    except ValueError:
        return "ignored"
    user = user_repo.get_by_id(session=session, user_id=user_id)
    if kind == "DELETE":
        if user is None:
            return "absent"
        before = audit.snapshot(user, ("id", "email", "tenant_id"))
        user_repo.delete_user_cascade(session=session, user=user)
        audit.record(
            session=session,
            actor_id=None,
            action="user.erase_from_auth",
            target_type="user",
            target_id=user_id,
            before=before,
        )
        return "erased"
    if kind in ("INSERT", "UPDATE") and user is not None:
        email = record.get("email")
        if isinstance(email, str) and email and email != user.email:
            user_repo.update(session=session, user=user, update_data={"email": email})
            return "updated"
    return "noop"
