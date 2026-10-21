"""Activity rows, realtime events and push for the social module.

Events and pushes go out only AFTER the use case commits: a recipient woken
by an event must find the row when it refetches, and a rolled-back write must
wake nobody. Use cases queue them with :func:`event` / :func:`push` and end
with :func:`commit` instead of ``ctx.commit()``.

Payloads carry ids and small fields the recipient may already see (ADR-0013:
an event is a nudge, the row is the record).
"""

import logging
import uuid
from collections.abc import Callable, Iterable
from concurrent.futures import ThreadPoolExecutor
from typing import Any

from sqlmodel import col, select

from app.modules.profile.models import PushDevice
from app.modules.realtime import public as realtime
from app.modules.social.models import Activity
from app.shared import events
from app.shared.context import Ctx
from app.shared.ids import derived_id
from app.shared.push import PushMessage, send_push

logger = logging.getLogger(__name__)

_AFTER = "social_after_commit"

_pool = ThreadPoolExecutor(max_workers=2, thread_name_prefix="social-push")


def _background(fn: Callable[[], None]) -> None:
    _pool.submit(fn)


# One named seam: Expo calls leave the request thread; tests run them inline.
run_push: Callable[[Callable[[], None]], None] = _background


def after_commit(ctx: Ctx, fn: Callable[[], None]) -> None:
    ctx.session.info.setdefault(_AFTER, []).append(fn)


def commit(ctx: Ctx) -> None:
    """End of a social use case: commit, then send what it queued."""
    ctx.commit()
    queued: list[Callable[[], None]] = ctx.session.info.pop(_AFTER, [])
    for fn in queued:
        try:
            fn()
        except Exception:  # noqa: BLE001 - a nudge never fails the write
            logger.warning("social post-commit hook failed", exc_info=True)


def event(
    ctx: Ctx, user_ids: Iterable[uuid.UUID], type_: str, data: dict[str, Any]
) -> None:
    targets = list(dict.fromkeys(user_ids))
    if targets:
        payload = dict(data)
        after_commit(ctx, lambda: events.publish_many(targets, type_, payload))


def _tokens(ctx: Ctx, user_ids: list[uuid.UUID]) -> list[tuple[uuid.UUID, str]]:
    rows = ctx.session.exec(
        select(PushDevice.owner_id, PushDevice.token).where(
            col(PushDevice.owner_id).in_(user_ids),
            PushDevice.tenant_id == ctx.tenant_id,
            col(PushDevice.deleted_at).is_(None),
            col(PushDevice.disabled_at).is_(None),
        )
    ).all()
    return [(uid, tok) for uid, tok in rows]


def push(
    ctx: Ctx,
    user_ids: Iterable[uuid.UUID],
    *,
    title: str,
    body: str,
    data: dict[str, Any],
    thread: str | None = None,
) -> None:
    """Push to each recipient that has no live event stream right now."""
    targets = [u for u in dict.fromkeys(user_ids) if u != ctx.user_id]
    if not targets:
        return

    def _send() -> None:
        offline = [u for u in targets if not realtime.is_live(u)]
        if not offline:
            return
        messages = [
            PushMessage(token=tok, title=title, body=body, data=data, thread=thread)
            for _uid, tok in _tokens(ctx, offline)
        ]
        if messages:
            run_push(lambda: _deliver(messages))

    after_commit(ctx, _send)


def _deliver(messages: list[PushMessage]) -> None:
    try:
        send_push(messages)
    except Exception:  # noqa: BLE001 - Expo being down never fails a write
        logger.warning("social push failed", exc_info=True)


# ---------------------------------------------------------------- activity


def activity_id(
    recipient: uuid.UUID, kind: str, key: str, actor: uuid.UUID
) -> uuid.UUID:
    """One activity row per (recipient, kind, subject, actor): liking again
    revives the row instead of stacking a second one."""
    return derived_id("social-activity", recipient, f"{kind}:{key}:{actor}")


def record(
    ctx: Ctx,
    *,
    recipient: uuid.UUID,
    kind: str,
    key: str,
    post_id: uuid.UUID | None = None,
    text: str | None = None,
) -> Activity | None:
    """Write (or revive) an activity for ``recipient``; nothing when the
    recipient is the actor. Queues the ``social.activity`` event."""
    if recipient == ctx.user_id:
        return None
    row_id = activity_id(recipient, kind, key, ctx.user_id)
    row = ctx.session.get(Activity, row_id)
    clipped = text[:280] if text else None
    if row is None:
        row = Activity(
            id=row_id,
            owner_id=recipient,
            tenant_id=ctx.tenant_id,
            actor_id=ctx.user_id,
            kind=kind,
            at=ctx.now,
            post_id=post_id,
            text=clipped,
        )
    else:
        row.at = ctx.now
        row.text = clipped
        row.post_id = post_id
        row.deleted_at = None
    ctx.session.add(row)
    ctx.session.flush()
    event(
        ctx,
        [recipient],
        "social.activity",
        {
            "id": str(row.id),
            "kind": kind,
            "actor_id": str(ctx.user_id),
            "post_id": str(post_id) if post_id else None,
        },
    )
    return row


def retract(ctx: Ctx, *, recipient: uuid.UUID, kind: str, key: str) -> None:
    """Withdraw an activity the caller caused (unlike, unfollow, delete)."""
    if recipient == ctx.user_id:
        return
    row = ctx.session.get(Activity, activity_id(recipient, kind, key, ctx.user_id))
    if row is not None and row.deleted_at is None:
        row.deleted_at = ctx.now
        ctx.session.add(row)
        ctx.session.flush()
