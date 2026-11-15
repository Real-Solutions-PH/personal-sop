"""The engagement-nudge sender (docs/26-retention-algorithms.md §3.2-3.5).

Registered as ``retention_nudges`` (every 5 min). For each person with a
retention profile, once their nudge time has come today, it decides once
for the day: the best-time nudge or that day's ladder step, or why not
(opted out, already active today, quiet hours, fatigue, backoff, budget,
nothing to point at, holdout, another push under 45 min before). The
decision is one ``nudge`` row keyed by the business day, so an overlapping
or retried run never sends twice; a nudge that goes out is an inbox
notification with a push from Fern (the companion's name as the title, and
Fern's picture where the phone's notification extension adds it), through
the dashboard outbox.

What the best-time nudge says comes from the person's state and persona
(``topics``): a bill due, a habit one day short of a milestone, a habit
they usually do around now, an empty plan, the evening wrap-up, a weigh-in
a week old, a first-week day, or their next habit or task, weighted toward
what their archetype says they use Unfurl for. Templates, not a model: the
text is deterministic, free, and testable for banned copy.

Reminders the person set (task, habit, bill, check-in, digest) are not
engagement nudges and are never held back here.
"""

import uuid
from datetime import date, datetime, timedelta

from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, col, select

from app.logger import app_logger
from app.modules.companion.defaults import COMPANION_NAME
from app.modules.companion.models import Companion
from app.modules.dashboard import public as dashboard
from app.modules.finance import calc as finance_calc
from app.modules.finance import repo as finance_repo
from app.modules.fitness.models import WeighIn
from app.modules.habits import logic as habit_logic
from app.modules.habits import public as habits
from app.modules.habits.models import HabitPause
from app.modules.iam.users.models import User
from app.modules.profile.models import MODULE_KEYS, ModulePref, PushDevice, UserProfile
from app.modules.retention import copy, signals
from app.modules.retention import logic as L
from app.modules.retention import topics as T
from app.modules.retention.jobs import gap_minutes, quiet_hours, reminder_minutes
from app.modules.retention.models import Nudge, RetentionProfile
from app.modules.tasks import logic as task_logic
from app.modules.tasks import repo as task_repo
from app.shared import owned_repo
from app.shared.context import Ctx, make_ctx
from app.shared.day import parse_hm
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
        reminders=gap_minutes(ctx, profile),
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


# ------------------------------------------------- best-time topics (persona)

# Someone who logged this many tasks in 28 days plans their days with
# Unfurl: an empty today or tomorrow is worth a nudge.
USES_TASKS_LOGS = 3
# A topic sent this many days back still counts as recent (topics.pick).
RECENT_TOPIC_DAYS = 2


def _modules_on(ctx: Ctx) -> set[str]:
    off = {p.module for p in owned_repo.list_rows(ctx, ModulePref) if not p.enabled}
    return set(MODULE_KEYS) - off


def _local_minute(ctx: Ctx, at: datetime) -> int:
    local = at.astimezone(ctx.clock.zone)
    return local.hour * 60 + local.minute


def _habit_candidates(
    ctx: Ctx, *, minute: int
) -> tuple[list[T.Candidate], int, int, T.Candidate | None]:
    """Habit topics for today, the day's done and due habit counts, and the
    first pending habit (for the first-week note)."""
    today = ctx.today
    world = habits.load_world(ctx, since=today - timedelta(days=400))
    since = today - timedelta(days=28)
    logged: dict[str, list[int]] = {}
    for (hid, day), lg in world.idx.items():
        if day >= since and lg.status in ("done", "partial"):
            logged.setdefault(hid, []).append(_local_minute(ctx, lg.logged_at))
    out: list[T.Candidate] = []
    first: T.Candidate | None = None
    due = done = 0
    for v in world.active_views():
        if not habit_logic.is_due(v, today):
            continue
        cell = habit_logic.cell_for(v, today, world.idx, today)
        if cell in ("done", "partial", "pending"):
            due += 1
        if cell in ("done", "partial"):
            done += 1
        if cell != "pending":
            continue
        href = f"/habits/{v.id}"
        st = habit_logic.streaks(v, world.idx, today)
        milestone = T.next_milestone(st.current)
        if milestone is not None:
            out.append(T.Candidate("near_best", href, v.name, count=milestone))
        usual = T.usual_minute(logged.get(v.id, []))
        if usual is not None and T.near(minute, usual):
            out.append(T.Candidate("habit_usual", href, v.name))
        if first is None:
            first = T.Candidate(
                "habit_due",
                href,
                v.name,
                rest_ready=grace_ready(st.current, st.grace_days, today),
            )
            out.append(first)
    return out, done, due, first


def _task_candidates(
    ctx: Ctx, *, uses_tasks: bool
) -> tuple[list[T.Candidate], int, int]:
    """Task topics for today and the day's done and due task counts."""
    d = task_logic.today_data(task_repo.load_state(ctx).state, ctx.now, ctx.clock)
    out: list[T.Candidate] = []
    for t in d.overdue + d.due:
        out.append(T.Candidate("task_due", f"/tasks/task/{t.id}", t.title))
        break
    if uses_tasks and not (d.overdue or d.due):
        out.append(T.Candidate("plan_today", copy.PLAN_HREF))
    tomorrow = d.upcoming[0].tasks if d.upcoming else []
    if uses_tasks and not tomorrow:
        out.append(T.Candidate("plan_tomorrow", copy.PLAN_HREF))
    done = len(d.done_due_today)
    return out, done, len(d.due) + done


def _bill_candidate(ctx: Ctx) -> T.Candidate | None:
    """The first unpaid bill due today or tomorrow that the person pays by
    hand (auto-logged ones need nothing from them)."""
    today = ctx.today
    s = finance_repo.load_state(ctx)
    for o in finance_calc.occurrences_in(s, today, today + timedelta(days=1)):
        if o.item.type == "expense" and o.status == "due" and not o.item.auto_log:
            return T.Candidate(
                "bill_due", f"/finance/planned/{o.item.id}", tomorrow=o.day > today
            )
    return None


def _weigh_in_candidate(ctx: Ctx) -> T.Candidate | None:
    last = ctx.session.exec(
        select(func.max(WeighIn.measured_at)).where(
            WeighIn.owner_id == ctx.user_id, col(WeighIn.deleted_at).is_(None)
        )
    ).first()
    if last is None:
        return None
    days = (ctx.today - ctx.clock.day_of(last)).days
    return (
        T.Candidate("weigh_in", copy.BODY_HREF, count=days)
        if T.weigh_in_due(days)
        else None
    )


def candidates(
    ctx: Ctx, *, minute: int, uses_tasks: bool, new: bool
) -> list[T.Candidate]:
    """Every best-time topic that is true for the person right now, in the
    modules they keep on."""
    on = _modules_on(ctx)
    out: list[T.Candidate] = []
    done = due = 0
    first: T.Candidate | None = None
    if "finance" in on:
        bill = _bill_candidate(ctx)
        if bill is not None:
            out.append(bill)
    if "habits" in on:
        found, h_done, h_due, first = _habit_candidates(ctx, minute=minute)
        out += found
        done, due = done + h_done, due + h_due
    if "tasks" in on:
        found, t_done, t_due = _task_candidates(ctx, uses_tasks=uses_tasks)
        out += found
        done, due = done + t_done, due + t_due
    if "fitness" in on:
        weigh = _weigh_in_candidate(ctx)
        if weigh is not None:
            out.append(weigh)
    if not dashboard.sealed_days(ctx, first=ctx.today, last=ctx.today):
        out.append(T.Candidate("wrap_up", copy.WRAP_UP_HREF, done=done, due=due))
    signup = ctx.clock.day_of(ctx.user.created_at) if ctx.user.created_at else ctx.today
    day_n = T.first_week_day((ctx.today - signup).days)
    if new and day_n is not None:
        out.append(
            T.Candidate(
                "first_week",
                first.href if first else copy.TODAY_HREF,
                first.title if first else "",
                count=day_n,
            )
        )
    return out


def _recent_topics(ctx: Ctx) -> set[str]:
    rows = owned_repo.list_rows(
        ctx,
        Nudge,
        col(Nudge.day) >= ctx.today - timedelta(days=RECENT_TOPIC_DAYS),
        col(Nudge.sent_at).is_not(None),
        col(Nudge.topic).is_not(None),
    )
    return {r.topic for r in rows if r.topic}


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
    task_logs = sum(a == "tasks" for _, a in month)
    prefer_tasks = (
        rp.archetype == "planner"
        if rp.archetype
        else task_logs > sum(a == "habits" for _, a in month)
    )
    msg: copy.Message | None
    topic: str | None = None
    if kind == "best_time":
        evening = parse_hm(profile.evening_start if profile else "18:00")
        picked = T.pick(
            candidates(
                ctx,
                minute=minute,
                uses_tasks=task_logs >= USES_TASKS_LOGS,
                new=rp.stage == "new",
            ),
            phase=T.phase_of(minute, evening[0] * 60 + evening[1]),
            archetype=rp.archetype,
            secondary=rp.secondary,
            recent=_recent_topics(ctx),
        )
        msg = (
            copy.render_topic(
                picked,
                name=_companion_name(ctx),
                person=profile.name if profile else None,
            )
            if picked is not None
            else None
        )
        topic = picked.topic if picked is not None else None
    else:
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
    if decision.suppressed in (None, "holdout"):
        # Never on top of another push: wait out the gap, or let the day go
        # when the gap outlasts the late limit (the holdout's would-be send
        # is held the same way, so the arms stay comparable).
        hold = L.recent_push_hold(
            at=at,
            now=ctx.now,
            last_push=signals.last_push_at(
                ctx.session, ctx.user_id, ctx.now - L.RECENT_PUSH_GAP
            ),
            late_limit=LATE_LIMIT,
        )
        if hold == "wait":
            ctx.session.rollback()
            return None
        if hold == "skip":
            decision = L.Decision(decision.kind, "recent_push")
    row = Nudge(
        **ctx.owned(),
        day=today,
        kind=decision.kind,
        scheduled_for=at,
        suppressed=decision.suppressed,
        arm=rp.arm,
        dedupe_key=key,
        topic=topic,
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
            fern=msg.title,
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
