"""Append-only audit helper.

Call :func:`record` from a privileged service function AFTER the mutation it
describes has committed. The row is a durable "who changed what, when" trail
for account-takeover / privilege-escalation forensics and GDPR accountability.

Snapshots (``before``/``after``) must never carry secrets — pass an explicit
allow-list of fields via :func:`snapshot`, not the whole model.
"""

import uuid
from datetime import datetime
from typing import Any

from sqlmodel import Session

from app.logger import app_logger
from app.modules.audit.models import AuditLog


def snapshot(obj: object, fields: tuple[str, ...]) -> dict[str, Any]:
    """JSON-safe dict of just ``fields`` from ``obj``.

    Explicit allow-list so secrets (passwords, tokens, MCP ``config``) can
    never be swept into an audit row by accident.
    """
    out: dict[str, Any] = {}
    for field in fields:
        value = getattr(obj, field)
        if isinstance(value, uuid.UUID):
            value = str(value)
        elif isinstance(value, datetime):
            value = value.isoformat()
        out[field] = value
    return out


def record(
    *,
    session: Session,
    action: str,
    target_type: str,
    actor_id: uuid.UUID | None = None,
    target_id: object | None = None,
    before: dict[str, Any] | None = None,
    after: dict[str, Any] | None = None,
) -> AuditLog:
    """Insert one append-only audit row and commit it.

    Committed separately, right after the caller's mutation: the mutation is
    the source of truth, and a best-effort trail that lands just after it is
    the right trade-off here (making the two strictly atomic would mean the
    repos could not commit on their own). ``actor_id=None`` marks a
    system/unattributed action — some privileged routes do not yet forward
    the current user down to the service (see the users/AI service callers).
    """
    entry = AuditLog(
        actor_id=actor_id,
        action=action,
        target_type=target_type,
        target_id=str(target_id) if target_id is not None else None,
        before=before,
        after=after,
    )
    session.add(entry)
    session.commit()
    session.refresh(entry)
    app_logger.info(
        "audit action=%s target=%s:%s actor=%s",
        action,
        target_type,
        entry.target_id,
        actor_id,
    )
    return entry
