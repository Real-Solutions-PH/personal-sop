"""Reminder and morning-digest jobs (F-TSK-35, F-TSK-39).

Plain functions: the scheduler (procrastinate) calls :func:`run_reminders`
and :func:`run_digests` every few minutes. Both are idempotent. Every post
carries a ``dedupe_key``, so a rerun, an overlapping run or a generous
look-back never pings twice.

Quiet hours are read in the user's clock. A reminder the owner timed
explicitly (the task has a due time) fires on time; a date-only task's
default reminder, and the digest, wait for the end of quiet hours.
"""

import uuid
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime, timedelta

from sqlmodel import Session, col, select

from app.modules.dashboard import public as dashboard
from app.modules.iam.users.models import User
from app.modules.tasks import logic, repo
from app.modules.tasks.models import Task, TaskSettings
from app.shared import owned_repo
from app.shared.context import Ctx, make_ctx
from app.shared.day import DayClock, parse_hm

# How far back a reminder still counts as "due now" (covers a scheduler
# outage and the longest quiet-hour deferral).
LOOKBACK = timedelta(hours=24)


def fmt_time(hm: str) -> str:
    """``fmtTime``: "15:00" -> "3 PM", "09:30" -> "9:30 AM"."""
    h, m = parse_hm(hm)
    ap = "PM" if h >= 12 else "AM"
    h12 = h % 12 or 12
    return f"{h12}:{m:02d} {ap}" if m else f"{h12} {ap}"


def in_quiet_hours(hm: str, start: str, end: str) -> bool:
    """Is the wall-clock ``hm`` inside ``[start, end)``? Windows may wrap
    midnight (22:00-07:00); an empty window (start == end) is never quiet."""
    if start == end:
        return False
    if start < end:
        return start <= hm < end
    return hm >= start or hm < end


def deliver_at(
    at: datetime, *, explicit: bool, quiet_start: str, quiet_end: str, clock: DayClock
) -> datetime:
    """When a notification due at ``at`` may go out."""
    if explicit:
        return at
    local = at.astimezone(clock.zone)
    if not in_quiet_hours(f"{local:%H:%M}", quiet_start, quiet_end):
        return at
    h, m = parse_hm(quiet_end)
    end = local.replace(hour=h, minute=m, second=0, microsecond=0)
    if end <= local:
        end = (local + timedelta(days=1)).replace(
            hour=h, minute=m, second=0, microsecond=0
        )
    return end.astimezone(at.tzinfo)


@dataclass(frozen=True)
class DueReminder:
    task: logic.TaskView
    deliver_at: datetime


def reminders_due(
    tasks: Sequence[logic.TaskView],
    *,
    now: datetime,
    quiet_start: str,
    quiet_end: str,
    clock: DayClock,
    lookback: timedelta = LOOKBACK,
) -> list[DueReminder]:
    """Open tasks whose reminder (after any quiet-hour deferral) is due."""
    out: list[DueReminder] = []
    for t in tasks:
        if t.status != "open" or t.deleted_at is not None or t.remind_at is None:
            continue
        if not (now - lookback <= t.remind_at <= now):
            continue
        when = deliver_at(
            t.remind_at,
            explicit=bool(t.due_time),
            quiet_start=quiet_start,
            quiet_end=quiet_end,
            clock=clock,
        )
        if when <= now:
            out.append(DueReminder(task=t, deliver_at=when))
    return sorted(out, key=lambda r: r.deliver_at)


def reminder_dedupe_key(task_id: str, remind_at: datetime) -> str:
    # A snooze moves remind_at, so the snoozed ping is a new notification.
    return f"task-remind:{task_id}:{remind_at.isoformat()}"


@dataclass(frozen=True)
class Digest:
    title: str
    body: str
    due: int
    overdue: int


def digest_for(
    state: logic.TasksState,
    *,
    now: datetime,
    digest_time: str,
    quiet_start: str,
    quiet_end: str,
    clock: DayClock,
) -> Digest | None:
    """Today's digest once its time (out of quiet hours) has passed, or None
    when it is not time yet or there is nothing to say."""
    today = clock.day_of(now)
    at = deliver_at(
        clock.local_time(today, digest_time),
        explicit=False,
        quiet_start=quiet_start,
        quiet_end=quiet_end,
        clock=clock,
    )
    if now < at or clock.day_of(at) != today:
        return None
    d = logic.today_data(state, now, clock)
    due, overdue = len(d.due), len(d.overdue)
    if not due and not overdue:
        return None
    noun = "task" if due == 1 else "tasks"
    body = ", ".join(t.title for t in (d.overdue + d.due)[:3])
    return Digest(
        title=f"{due} {noun} today · {overdue} overdue",
        body=body,
        due=due,
        overdue=overdue,
    )


# ---------------------------------------------------------------- per user


def send_reminders(ctx: Ctx) -> int:
    """Post every due reminder for one user. Returns how many were new."""
    settings = repo.settings_or_default(ctx)
    rows = owned_repo.list_rows(
        ctx,
        Task,
        col(Task.status) == "open",
        col(Task.remind_at).is_not(None),
        col(Task.remind_at) <= ctx.now,
        col(Task.remind_at) >= ctx.now - LOOKBACK,
    )
    sent = 0
    for r in reminders_due(
        [repo.task_view(t) for t in rows],
        now=ctx.now,
        quiet_start=settings.quiet_start,
        quiet_end=settings.quiet_end,
        clock=ctx.clock,
    ):
        t = r.task
        if t.remind_at is None:  # narrowed by reminders_due
            continue
        posted = dashboard.notify(
            ctx,
            kind="reminder",
            title=t.title,
            body=fmt_time(t.due_time) if t.due_time else "Reminder",
            href=f"/tasks/task/{t.id}",
            dedupe_key=reminder_dedupe_key(t.id, t.remind_at),
            push=True,
        )
        sent += posted is not None
    ctx.commit()
    return sent


def send_digest(ctx: Ctx) -> bool:
    settings = repo.settings_or_default(ctx)
    if not settings.digest_on:
        return False
    digest = digest_for(
        repo.load_state(ctx).state,
        now=ctx.now,
        digest_time=settings.digest_time,
        quiet_start=settings.quiet_start,
        quiet_end=settings.quiet_end,
        clock=ctx.clock,
    )
    if digest is None:
        return False
    posted = dashboard.notify(
        ctx,
        kind="reminder",
        title=digest.title,
        body=digest.body,
        href="/tasks",
        dedupe_key=f"task-digest:{ctx.today.isoformat()}",
        push=True,
    )
    ctx.commit()
    return posted is not None


# ---------------------------------------------------------------- all users


def _users(session: Session, ids: Sequence[uuid.UUID]) -> list[User]:
    if not ids:
        return []
    return list(session.exec(select(User).where(col(User.id).in_(list(ids)))).all())


def run_reminders(session: Session, *, now: datetime) -> int:
    """Job entry point: every user with a reminder in the look-back window."""
    owners = session.exec(
        select(Task.owner_id)
        .where(
            Task.status == "open",
            col(Task.deleted_at).is_(None),
            col(Task.remind_at).is_not(None),
            col(Task.remind_at) <= now,
            col(Task.remind_at) >= now - LOOKBACK,
        )
        .distinct()
    ).all()
    return sum(
        send_reminders(make_ctx(session, u, now=now)) for u in _users(session, owners)
    )


def run_digests(session: Session, *, now: datetime) -> int:
    """Job entry point: every user with the morning digest on."""
    owners = session.exec(
        select(TaskSettings.owner_id).where(
            col(TaskSettings.digest_on).is_(True),
            col(TaskSettings.deleted_at).is_(None),
        )
    ).all()
    return sum(
        send_digest(make_ctx(session, u, now=now)) for u in _users(session, owners)
    )
