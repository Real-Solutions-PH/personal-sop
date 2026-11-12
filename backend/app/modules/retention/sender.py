"""The engagement-nudge sender (docs/26-retention-algorithms.md §3.2-3.5).

Registered as ``retention_nudges`` (every 5 min). For each person with a
retention profile, once their nudge time has come today, it decides once
for the day: the best-time nudge or that day's ladder step, or why not
(opted out, already active today, quiet hours, fatigue, backoff, budget,
nothing to point at, holdout). The decision is one ``nudge`` row keyed by
the business day, so an overlapping or retried run never sends twice; a
nudge that goes out is an inbox notification with a push, through the
dashboard outbox.

Reminders the person set (task, habit, bill, check-in, digest) are not
engagement nudges and are never held back here.
"""

import uuid
from datetime import date, datetime, timedelta

from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, col, select

from app.logger import app_logger
from app.modules.companion.defaults import COMPANION_NAME
from app.modules.companion.models import Companion
from app.modules.dashboard import public as dashboard
from app.modules.habits import logic as habit_logic
from app.modules.habits import public as habits
from app.modules.habits.models import HabitPause
from app.modules.iam.users.models import User
from app.modules.profile.models import PushDevice, UserProfile
from app.modules.retention import copy, signals
from app.modules.retention import logic as L
from app.modules.retention.jobs import quiet_hours, reminder_minutes
from app.modules.retention.models import Nudge, RetentionProfile
from app.modules.tasks import logic as task_logic
from app.modules.tasks import repo as task_repo
from app.shared import owned_repo
from app.shared.context import Ctx, make_ctx
from app.shared.grace import grace_ready

# A run that comes this late after the nudge time (the scheduler was down)
# lets the day go rather than nudge at an odd hour.
LATE_LIMIT = timedelta(hours=1)
WAY_BACK = "way_back"
WAY_BACK_EVERY_DAYS = 30


def dedupe_key(day: date) -> str:
    return f"nudge:{day.isoformat()}"


def send_time(
    ctx: Ctx, rp: RetentionProfile, profile: UserProfile | None
) -> datetime | None:
    """Today's nudge time as an aware instant: the pinned time if the person
    chose one, else just before their usual slot for this kind of day,
    chosen again here against TODAY's reminders and quiet hours (the
    nightly run, at 03:xx, may still be on the day before)."""
    pinned = profile.nudge_time if profile else None
    if pinned:
        return ctx.clock.local_time(ctx.today, pinned)
    hist = (rp.slot_hist or {}).get(L.day_type(ctx.today))
    quiet = quiet_hours(ctx)
    ok = L.eligible_slots(
        quiet_start=quiet[0],
        quiet_end=quiet[1],
        reminders=reminder_minutes(ctx, profile),
    )
    slot = L.best_slot(
        hist if hist and len(hist) == L.SLOTS else [0.0] * L.SLOTS,
        ok,
        push_evening=profile.push_evening if profile else None,
        push_morning=profile.push_morning if profile else None,
    )
    if slot is None:
        return None
    m = L.send_minute(slot)
    return ctx.clock.local_time(ctx.today, f"{m // 60:02d}:{m % 60:02d}")


def usual_time(rp: RetentionProfile | None, day: date) -> str | None:
    """The usual nudge time (HH:MM) the histogram found, for Settings."""
    if rp is None:
        return None
    slot = (
        rp.best_slot_weekend if L.day_type(day) == "weekend" else rp.best_slot_weekday
    )
    if slot is None:
        return None
    m = L.send_minute(slot)
    return f"{m // 60:02d}:{m % 60:02d}"


# ---------------------------------------------------------------- content


def _companion_name(ctx: Ctx) -> str:
    name = ctx.session.exec(
        select(Companion.name).where(Companion.owner_id == ctx.user_id)
    ).first()
    return (name or "").strip() or COMPANION_NAME


def _habit_pick(ctx: Ctx) -> tuple[copy.Item, bool] | None:
    """The first habit due today and not yet done, in the person's order,
    and whether a rest day is ready on its streak."""
    today = ctx.today
    world = habits.load_world(ctx, since=today - timedelta(days=400))
    for v in world.active_views():
        if not habit_logic.is_due(v, today):
            continue
        if habit_logic.cell_for(v, today, world.idx, today) != "pending":
            continue
        st = habit_logic.streaks(v, world.idx, today)
        return (
            copy.Item("habit", v.id, v.name),
            grace_ready(st.current, st.grace_days, today),
        )
    return None


def _task_pick(ctx: Ctx) -> copy.Item | None:
    """Today's first open task: overdue first, then due today."""
    d = task_logic.today_data(task_repo.load_state(ctx).state, ctx.now, ctx.clock)
    for t in d.overdue + d.due:
        return copy.Item("task", t.id, t.title)
    return None


def _way_back_ready(ctx: Ctx) -> bool:
    """No way-back pause in the last 30 days, so a return would pause the
    streaks across the gap."""
    since = ctx.today - timedelta(days=WAY_BACK_EVERY_DAYS)
    held = owned_repo.find_one(
        ctx,
        HabitPause,
        col(HabitPause.reason) == WAY_BACK,
        col(HabitPause.from_day) >= since,
    )
    return held is None


def content(ctx: Ctx, kind: L.NudgeKind, *, prefer_tasks: bool) -> copy.Message | None:
    """The message for today's nudge: the person's top habit or task (tasks
    first for someone who logs tasks more than habits)."""
    habit = _habit_pick(ctx)
    task = _task_pick(ctx)
    rest = False
    item: copy.Item | None
    if prefer_tasks:
        item = task or (habit[0] if habit else None)
    else:
        item = habit[0] if habit else task
    if habit is not None and item is habit[0]:
        rest = habit[1]
    return copy.render(
        kind,
        name=_companion_name(ctx),
        item=item,
        rest_ready=rest,
        way_back_ready=kind == "ladder_7" and _way_back_ready(ctx),
    )


# ---------------------------------------------------------------- per user


def _sent_last_7(ctx: Ctx) -> int:
    return owned_repo.count_rows(
        ctx,
        Nudge,
        col(Nudge.day) >= ctx.today - timedelta(days=6),
        col(Nudge.day) < ctx.today,
        col(Nudge.sent_at).is_not(None),
    )


def _reachable(ctx: Ctx) -> bool:
    return (
        ctx.session.exec(
            select(PushDevice.id).where(
                PushDevice.owner_id == ctx.user_id,
                col(PushDevice.deleted_at).is_(None),
                col(PushDevice.disabled_at).is_(None),
            )
        ).first()
        is not None
    )


def _record(ctx: Ctx, row: Nudge) -> bool:
    """Insert the day's decision; False when another run got there first."""
    savepoint = ctx.session.begin_nested()
    try:
        ctx.session.add(row)
        ctx.session.flush()
    except IntegrityError:
        savepoint.rollback()
        return False
    savepoint.commit()
    return True


def send_for(ctx: Ctx) -> Nudge | None:
    """Decide (once) and maybe send today's nudge for one person. Returns
    the day's new nudge row, or None when nothing was due or decided."""
    rp = owned_repo.find_one(ctx, RetentionProfile)
    if rp is None:
        return None
    today = ctx.today
    key = dedupe_key(today)
    if owned_repo.find_one(ctx, Nudge, col(Nudge.dedupe_key) == key) is not None:
        return None
    profile = owned_repo.find_one(ctx, UserProfile)
    at = send_time(ctx, rp, profile)
    if at is None or ctx.now < at or ctx.now - at > LATE_LIMIT:
        return None

    latest = signals.latest_log_at(ctx.session, ctx.user_id)
    last_day = ctx.clock.day_of(latest) if latest else None
    since = L.days_since(today, last_day)
    lifetime = rp.log_days_total + (
        1
        if last_day is not None
        and (rp.last_log_day is None or last_day > rp.last_log_day)
        else 0
    )
    kind = L.kind_for(since, lifetime_log_days=lifetime)
    if kind is None:
        return None
    opened = signals.app_opens(ctx.session, ctx.user_id, ctx.clock.start_of(today))
    quiet = quiet_hours(ctx)
    local = ctx.now.astimezone(ctx.clock.zone)
    minute = local.hour * 60 + local.minute
    in_quiet = (
        L.in_quiet(minute, quiet[0], quiet[1])
        or not L.WINDOW_START <= minute <= L.WINDOW_END
    )
    month = signals.log_moments(
        ctx.session, ctx.user_id, since=ctx.now - timedelta(days=28)
    )
    prefer_tasks = sum(a == "tasks" for _, a in month) > sum(
        a == "habits" for _, a in month
    )
    msg = content(ctx, kind, prefer_tasks=prefer_tasks)
    mode = (profile.nudge_mode if profile else "daily") or "daily"
    decision = L.decide(
        mode=mode,  # type: ignore[arg-type]
        stage=rp.stage,
        days_since_log=since,
        lifetime_log_days=lifetime,
        active_today=bool(opened),
        in_quiet=in_quiet,
        ignore_streak=rp.ignore_streak,
        next_nudge_after=rp.next_nudge_after,
        today=today,
        sent_last_7=_sent_last_7(ctx),
        reminders_today=len(reminder_minutes(ctx, profile)),
        has_content=msg is not None,
        holdout=rp.arm == "holdout",
    )
    if decision is None:
        return None
    if decision.suppressed in (None, "holdout") and not _reachable(ctx):
        # No phone to push to (permission off, or every token disabled): a
        # nudge nobody can receive is not a send, not an ignore, and not a
        # holdout counterfactual either.
        decision = L.Decision(decision.kind, "no_push")
    row = Nudge(
        **ctx.owned(),
        day=today,
        kind=decision.kind,
        scheduled_for=at,
        suppressed=decision.suppressed,
        arm=rp.arm,
        dedupe_key=key,
    )
    if not _record(ctx, row):
        ctx.session.rollback()
        return None
    if decision.suppressed is None and msg is not None:
        note = dashboard.notify(
            ctx,
            kind="reminder",
            title=msg.title,
            body=msg.body,
            href=msg.href,
            dedupe_key=key,
            push=True,
        )
        if note is not None:
            row.notification_id = note.id
            row.sent_at = ctx.now
            ctx.session.add(row)
    ctx.commit()
    return row


def run_nudges(session: Session, *, now: datetime) -> int:
    """Job entry point: everyone with a retention profile. Returns how many
    nudges went out."""
    owners = session.exec(
        select(RetentionProfile.owner_id).where(
            col(RetentionProfile.deleted_at).is_(None)
        )
    ).all()
    if not owners:
        return 0
    sent = 0
    users = session.exec(
        select(User).where(
            col(User.id).in_(list(owners)), col(User.is_active).is_(True)
        )
    ).all()
    for user in users:
        try:
            row = send_for(make_ctx(session, user, now=now))
            sent += row is not None and row.sent_at is not None
        except Exception:  # one user's bad data must not stop the rest
            session.rollback()
            app_logger.exception("retention nudge failed for one user")
    return sent


def record_open(ctx: Ctx, notification_id: uuid.UUID, at: datetime) -> bool:
    """A push was tapped: if it was a nudge, stamp ``opened_at`` (first tap
    only) and clear the ignore streak. Returns whether a nudge matched.
    Flushes; the caller commits."""
    row = owned_repo.find_one(ctx, Nudge, col(Nudge.notification_id) == notification_id)
    if row is None:
        return False
    if row.opened_at is None:
        row.opened_at = at
        ctx.session.add(row)
    rp = owned_repo.find_one(ctx, RetentionProfile)
    if rp is not None and rp.ignore_streak:
        rp.ignore_streak = 0
        rp.next_nudge_after = None
        ctx.session.add(rp)
    ctx.session.flush()
    return True
