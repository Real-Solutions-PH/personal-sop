"""Cross-module contract of the dashboard module (implemented by dashboard).

None of these commit: the calling use case does. ``notify`` queues its push
and realtime event for AFTER that commit, so a rolled-back write wakes nobody
and a woken device always finds the row.
"""

import uuid
from datetime import date
from typing import Literal

from sqlalchemy.exc import IntegrityError
from sqlmodel import col, select

from app.modules.dashboard import outbox
from app.modules.dashboard.models import Goal, MissNote, Notification, WrapUp
from app.modules.stats.logic import GoalSpec
from app.shared import owned_repo
from app.shared.context import Ctx
from app.shared.ids import derived_id

NotifKind = Literal["reminder", "achievement", "review", "system", "social"]


def notification_id(recipient: uuid.UUID, dedupe_key: str) -> uuid.UUID:
    return derived_id("notification", recipient, dedupe_key)


def notify(
    ctx: Ctx,
    *,
    kind: NotifKind,
    title: str,
    body: str = "",
    href: str = "/today",
    dedupe_key: str | None = None,
    push: bool = False,
    recipient_id: uuid.UUID | None = None,
) -> Notification | None:
    """Post to the inbox (and optionally push). Returns None when
    ``dedupe_key`` already exists for the recipient (even dismissed: a
    reminder the user swiped away is not re-posted)."""
    recipient = recipient_id or ctx.user_id
    if dedupe_key is not None:
        row_id = notification_id(recipient, dedupe_key[:120])
        held = ctx.session.exec(
            select(Notification.id).where(
                Notification.owner_id == recipient,
                Notification.dedupe_key == dedupe_key[:120],
            )
        ).first()
        if held is not None:
            return None
    else:
        row_id = uuid.uuid4()
    row = Notification(
        id=row_id,
        owner_id=recipient,
        tenant_id=ctx.tenant_id,
        at=ctx.now,
        kind=kind,
        title=title[:120],
        body=body[:500],
        href=href[:255],
        read=False,
        dedupe_key=dedupe_key[:120] if dedupe_key else None,
    )
    savepoint = ctx.session.begin_nested()
    try:
        ctx.session.add(row)
        ctx.session.flush()
    except IntegrityError:
        # A concurrent job posted the same key first.
        savepoint.rollback()
        return None
    savepoint.commit()
    outbox.queue_event(ctx, recipient, row)
    if push:
        outbox.queue_push(ctx, recipient, row)
    return row


# ---------------------------------------------------------------- reads for stats


def sealed_days(
    ctx: Ctx, *, first: date | None = None, last: date | None = None
) -> list[date]:
    """Days the user wrapped up (sealed), optionally within ``[first, last]``."""
    where = []
    if first is not None:
        where.append(col(WrapUp.day) >= first)
    if last is not None:
        where.append(col(WrapUp.day) <= last)
    return [w.day for w in owned_repo.list_rows(ctx, WrapUp, *where)]


def goal_specs(ctx: Ctx) -> list[GoalSpec]:
    """Every live goal, newest first (the prototype prepends new goals)."""
    rows = owned_repo.list_rows(
        ctx, Goal, order_by=(col(Goal.created_at).desc(), col(Goal.id))
    )
    return [
        GoalSpec(
            id=str(g.id),
            metric=g.metric,
            label=g.label,
            target=g.target,
            unit=g.unit,
            comparator="lte" if g.comparator == "lte" else "gte",
            period="month" if g.period == "month" else "week",
            created=ctx.clock.day_of(g.created_at),
            status="archived" if g.status == "archived" else "active",
        )
        for g in rows
    ]


def miss_notes(ctx: Ctx, keys: list[str]) -> dict[str, str]:
    if not keys:
        return {}
    rows = owned_repo.list_rows(ctx, MissNote, col(MissNote.miss_key).in_(keys))
    return {r.miss_key: r.note for r in rows}
