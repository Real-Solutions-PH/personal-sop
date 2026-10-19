"""After-commit delivery of inbox notifications: the realtime event and the
Expo push.

``notify`` runs inside someone else's use case, which commits later (or rolls
back). It queues work on ``session.info``; a listener on every ORM session
sends it once the transaction COMMITS and drops it on rollback. Tokens are
read while the transaction is still open (the listener cannot emit SQL);
the bookkeeping after delivery (``pushed_at``, disabling a token Expo reports
as ``DeviceNotRegistered``) runs on a fresh owner session.
"""

import logging
import uuid
from collections.abc import Callable
from dataclasses import dataclass

from sqlalchemy import event
from sqlalchemy.orm import Session as OrmSession
from sqlmodel import Session, col, select

from app.modules.dashboard.models import Notification
from app.modules.profile.models import PushDevice
from app.shared import events
from app.shared.context import Ctx
from app.shared.owned import utcnow
from app.shared.push import PushMessage, send_push

logger = logging.getLogger(__name__)

_KEY = "dashboard_outbox"
EVENT_TYPE = "dashboard.notification"
NOT_REGISTERED = "DeviceNotRegistered"


@dataclass(frozen=True)
class _Event:
    recipient: uuid.UUID
    data: dict[str, object]


@dataclass(frozen=True)
class _Push:
    notification_id: uuid.UUID
    messages: list[PushMessage]


def _queue(ctx: Ctx, item: _Event | _Push) -> None:
    ctx.session.info.setdefault(_KEY, []).append(item)


def queue_event(ctx: Ctx, recipient: uuid.UUID, row: Notification) -> None:
    _queue(
        ctx,
        _Event(
            recipient,
            {
                "id": str(row.id),
                "kind": row.kind,
                "title": row.title,
                "href": row.href,
                "at": row.at.isoformat(),
            },
        ),
    )


def queue_push(ctx: Ctx, recipient: uuid.UUID, row: Notification) -> None:
    tokens = ctx.session.exec(
        select(PushDevice.token).where(
            PushDevice.owner_id == recipient,
            PushDevice.tenant_id == ctx.tenant_id,
            col(PushDevice.deleted_at).is_(None),
            col(PushDevice.disabled_at).is_(None),
        )
    ).all()
    if not tokens:
        return
    data = {"href": row.href, "notification_id": str(row.id), "kind": row.kind}
    messages = [
        PushMessage(
            token=t,
            title=row.title,
            body=row.body,
            data=data,
            thread=row.dedupe_key or None,
        )
        for t in dict.fromkeys(tokens)
    ]
    _queue(ctx, _Push(row.id, messages))


# ---------------------------------------------------------------- delivery


def _engine_session() -> Session:
    from app.core.db import engine

    return Session(engine)


# One named seam: tests point the bookkeeping at their own session factory.
session_factory: Callable[[], Session] = _engine_session


def _deliver_push(item: _Push) -> None:
    tickets = send_push(item.messages)
    if not tickets:
        return
    dead = [t.token for t in tickets if not t.ok and t.error == NOT_REGISTERED]
    with session_factory() as session:
        note = session.get(Notification, item.notification_id)
        if note is not None and any(t.ok for t in tickets):
            note.pushed_at = utcnow()
            session.add(note)
        if dead:
            for device in session.exec(
                select(PushDevice).where(
                    col(PushDevice.token).in_(dead),
                    col(PushDevice.disabled_at).is_(None),
                )
            ).all():
                device.disabled_at = utcnow()
                session.add(device)
        session.commit()


def deliver(items: list[_Event | _Push]) -> None:
    for item in items:
        try:
            if isinstance(item, _Event):
                events.publish(item.recipient, EVENT_TYPE, item.data)
            else:
                _deliver_push(item)
        except Exception:  # noqa: BLE001 - delivery never fails the write
            logger.warning("notification delivery failed", exc_info=True)


def _after_commit(session: OrmSession) -> None:
    items = session.info.pop(_KEY, None)
    if items:
        deliver(items)


def _after_rollback(session: OrmSession) -> None:
    session.info.pop(_KEY, None)


_installed = False


def install() -> None:
    global _installed
    if _installed:
        return
    event.listen(OrmSession, "after_commit", _after_commit)
    event.listen(OrmSession, "after_rollback", _after_rollback)
    _installed = True


install()
