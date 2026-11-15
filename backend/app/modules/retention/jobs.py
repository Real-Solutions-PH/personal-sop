"""The nightly retention profile (docs/26-retention-algorithms.md §3.1-3.3,
§4.1): archetype (persona), stage, churn risk, the slot histogram and best
slots, the ignore streak and backoff, and the holdout arm, for each person
once a day in their local 03:00 hour.

Registered as ``retention_nightly`` (hourly) in ``jobs.tasks``; each run
takes the people whose wall clock reads 03:xx and who have no profile for
today yet, so an overlapping or retried run is harmless.
"""

import uuid
from collections import Counter
from collections.abc import Sequence
from datetime import date, datetime, timedelta

from sqlmodel import Session, col, select

from app.logger import app_logger
from app.modules.habits import logic as habit_logic
from app.modules.habits.models import Habit, Routine
from app.modules.habits.views import slots as habit_slots
from app.modules.iam.users.models import User
from app.modules.profile.models import MODULE_KEYS, ModulePref, UserProfile
from app.modules.retention import logic as L
from app.modules.retention import signals
from app.modules.retention.models import Nudge, RetentionProfile
from app.modules.tasks import repo as task_repo
from app.modules.tasks.models import Task
from app.shared import owned_repo
from app.shared.context import Ctx, make_ctx
from app.shared.day import parse_hm

NIGHTLY_HOUR = 3


def reminder_minutes(ctx: Ctx, profile: UserProfile | None) -> list[int]:
    """Local minutes of the reminders the person set that fire today: task
    reminders, the morning digest, the daily Fern check-in. A nudge keeps
    45 min away from each, and four or more of them skip the day's nudge."""
    first, end = ctx.clock.window(ctx.today, ctx.today)
    out: list[int] = []
    for t in owned_repo.list_rows(
        ctx,
        Task,
        col(Task.status) == "open",
        col(Task.remind_at) >= first,
        col(Task.remind_at) < end,
    ):
        if t.remind_at is not None:
            local = t.remind_at.astimezone(ctx.clock.zone)
            out.append(local.hour * 60 + local.minute)
    settings = task_repo.settings_or_default(ctx)
    hms = [settings.digest_time] if settings.digest_on else []
    if profile is not None and profile.push_checkin:
        hms.append(profile.push_checkin)
    for hm in hms:
        h, m = parse_hm(hm)
        out.append(h * 60 + m)
    return sorted(out)


def phone_reminder_minutes(ctx: Ctx) -> list[int]:
    """Local minutes of the reminders the phone schedules itself today and
    the server can see: habits and routines with a reminder on a timed slot
    for today. A nudge keeps 45 min away from these too; they do not count
    toward the four-reminder budget (the phone's own bill, weigh-in and
    nag reminders are not known here)."""
    out: list[int] = []
    rows: list[Habit | Routine] = [
        *owned_repo.list_rows(
            ctx,
            Habit,
            col(Habit.reminder).is_(True),
            col(Habit.status) == "active",
            col(Habit.archived_at).is_(None),
        ),
        *owned_repo.list_rows(
            ctx,
            Routine,
            col(Routine.reminder).is_(True),
            col(Routine.status) == "active",
        ),
    ]
    for row in rows:
        slot = habit_logic.slot_for(habit_slots(row.schedule), ctx.today)
        if slot is not None and slot.time:
            h, m = parse_hm(slot.time)
            out.append(h * 60 + m)
    return sorted(out)


def gap_minutes(ctx: Ctx, profile: UserProfile | None) -> list[int]:
    """Every reminder time today a nudge keeps 45 min away from."""
    return sorted(reminder_minutes(ctx, profile) + phone_reminder_minutes(ctx))


def persona(ctx: Ctx, logs: Sequence[tuple[datetime, str]]) -> L.Persona:
    """The archetype from the last 28 days' logs, or the module weights."""
    since28 = ctx.now - timedelta(days=28)
    recent = [(at, a) for at, a in logs if at >= since28]
    weights = dict.fromkeys(MODULE_KEYS, 1)
    for pref in owned_repo.list_rows(ctx, ModulePref):
        weights[pref.module] = pref.weight if pref.enabled else 0
    return L.persona_of(
        area_logs=Counter(a for _, a in recent),
        weights=weights,
        fern_turns=signals.fern_turns(ctx.session, ctx.user_id, since28),
        log_days=len({ctx.clock.day_of(at) for at, _ in recent}),
    )


def quiet_hours(ctx: Ctx) -> tuple[str, str]:
    s = task_repo.settings_or_default(ctx)
    return s.quiet_start, s.quiet_end


def profile_row(ctx: Ctx) -> RetentionProfile | None:
    return owned_repo.find_one(ctx, RetentionProfile)


def _sent(ctx: Ctx, since: date) -> list[Nudge]:
    return owned_repo.list_rows(
        ctx,
        Nudge,
        col(Nudge.day) >= since,
        col(Nudge.sent_at).is_not(None),
        order_by=(col(Nudge.sent_at),),
    )


def compute(ctx: Ctx) -> RetentionProfile:
    """Rebuild one person's retention profile for today and store it."""
    today = ctx.today
    zone = ctx.clock.zone
    profile = owned_repo.find_one(ctx, UserProfile)
    logs = signals.log_moments(ctx.session, ctx.user_id)
    log_days = {ctx.clock.day_of(at) for at, _ in logs}
    since60 = ctx.now - timedelta(days=L.HISTORY_DAYS)
    opens = signals.app_opens(ctx.session, ctx.user_id, since60)
    moments = [at for at, _ in logs if at >= since60] + opens
    hist = L.slot_histogram(moments, now=ctx.now, zone=zone)
    quiet = quiet_hours(ctx)
    ok = L.eligible_slots(
        quiet_start=quiet[0],
        quiet_end=quiet[1],
        reminders=gap_minutes(ctx, profile),
    )
    evening = profile.push_evening if profile else None
    morning = profile.push_morning if profile else None
    best = {
        d: L.best_slot(hist[d], ok, push_evening=evening, push_morning=morning)
        for d in ("weekday", "weekend")
    }
    sent = _sent(ctx, today - timedelta(days=30))
    k = L.ignore_streak(
        [(n.sent_at, n.opened_at) for n in sent if n.sent_at is not None],
        app_opens=opens,
        now=ctx.now,
    )
    last = L.last_log_day(log_days)
    ladder = [
        n
        for n in sent
        if n.kind.startswith("ladder_") and (last is None or n.day > last)
    ]
    since28 = ctx.now - timedelta(days=28)
    areas = {a for at, a in logs if at >= since28}
    signup = ctx.clock.day_of(ctx.user.created_at) if ctx.user.created_at else today
    stage = L.stage_of(today=today, signup_day=signup, log_days=log_days)
    who = persona(ctx, logs)
    values: dict[str, object] = {
        "archetype": who.archetype,
        "secondary": who.secondary,
        "tags": who.tags,
        "stage": stage,
        "risk": L.risk_score(
            today=today,
            signup_day=signup,
            log_days=log_days,
            ignore_streak=k,
            areas_28d=len(areas),
        ),
        "last_log_day": last,
        "log_days_total": len(log_days),
        "slot_hist": hist,
        "best_slot_weekday": best["weekday"],
        "best_slot_weekend": best["weekend"],
        "ignore_streak": k,
        "next_nudge_after": L.next_nudge_after(
            ctx.clock.day_of(sent[-1].sent_at) if sent and sent[-1].sent_at else None,
            k,
        ),
        "ladder_step": int(ladder[-1].kind.split("_")[1]) if ladder else 0,
        "arm": L.arm_of(ctx.user_id),
        "computed_day": today,
    }
    row = profile_row(ctx)
    if row is None:
        row = owned_repo.insert(ctx, RetentionProfile, values)
    else:
        owned_repo.apply(row, values)
        ctx.session.add(row)
    ctx.commit()
    return row


# ---------------------------------------------------------------- all users


def due_now(
    people: Sequence[tuple[uuid.UUID, str | None]], now: datetime
) -> list[uuid.UUID]:
    """Of ``(user id, time zone)``, those whose wall clock reads 03:xx."""
    from zoneinfo import ZoneInfo

    out = []
    for uid, tz in people:
        try:
            zone = ZoneInfo(tz or "Asia/Manila")
        except Exception:  # noqa: BLE001 - a bad zone falls back to the default
            zone = ZoneInfo("Asia/Manila")
        if now.astimezone(zone).hour == NIGHTLY_HOUR:
            out.append(uid)
    return out


def run_nightly(session: Session, *, now: datetime) -> int:
    """Job entry point: everyone in their local 03:00 hour not yet done
    today. Returns how many profiles were rebuilt."""
    people = session.exec(
        select(User.id, UserProfile.timezone)
        .join(UserProfile, col(UserProfile.owner_id) == col(User.id), isouter=True)
        .where(col(User.is_active).is_(True))
    ).all()
    ids = due_now([(u, tz) for u, tz in people], now)
    if not ids:
        return 0
    done = 0
    for user in session.exec(select(User).where(col(User.id).in_(ids))).all():
        try:
            ctx = make_ctx(session, user, now=now)
            row = owned_repo.find_one(ctx, RetentionProfile)
            if row is not None and row.computed_day == ctx.today:
                continue
            compute(ctx)
            done += 1
        except Exception:  # one user's bad data must not stop the rest
            session.rollback()
            app_logger.exception("retention nightly failed for one user")
    return done
