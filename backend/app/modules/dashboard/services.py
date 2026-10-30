"""Use cases of the dashboard module: goals, reviews, the evening wrap-up,
the inbox, share defaults and cards, onboarding starters and the Today bundle.

Each public function is one use case and ends with ``ctx.commit()``.
"""

import uuid
from datetime import date, time, timedelta
from typing import Any, TypeVar

from sqlalchemy.exc import IntegrityError
from sqlmodel import col

from app.modules.capture import public as capture_public
from app.modules.dashboard import logic as D
from app.modules.dashboard.models import (
    Goal,
    MissNote,
    Notification,
    Review,
    ShareDefault,
    WrapUp,
)
from app.modules.dashboard.schema import (
    GoalCreate,
    GoalUpdate,
    OnboardingIn,
    ReviewIn,
    SealIn,
    WrapActionIn,
)
from app.modules.habits import public as habits_public
from app.modules.profile import public as profile_public
from app.modules.stats import public as stats_public
from app.modules.tasks import public as tasks_public
from app.shared import owned_repo
from app.shared.context import Ctx
from app.shared.day import parse_hm
from app.shared.domain import conflict, invalid, not_found
from app.shared.owned import OwnedRow

R = TypeVar("R", bound=OwnedRow)

STATS_MODULE = "habits"  # any rollup module: the drain recomputes the whole day


# ---------------------------------------------------------------- goals


def _check_goal(metric: str | None, target: float | None) -> None:
    if metric is not None and not D.valid_metric_ref(metric):
        raise invalid("goal_metric_invalid", "That metric can't be tracked as a goal")
    if target is not None and not D.finite(target):
        raise invalid("goal_target_invalid", "The target must be a number")


def require_goal(ctx: Ctx, goal_id: uuid.UUID) -> Goal:
    return owned_repo.require(ctx, Goal, goal_id, what="goal")


def create_goal(ctx: Ctx, data: GoalCreate) -> Goal:
    """``saveGoal`` without an id: a new active goal. Replaying the same
    client id returns the existing row."""
    _check_goal(data.metric, data.target)
    values = data.model_dump(exclude={"id"})
    if data.id is not None:
        existing = owned_repo.get(ctx, Goal, data.id, include_deleted=True)
        if existing is not None:
            return existing
    row = _insert(ctx, Goal, {**values, "status": "active"}, data.id)
    ctx.commit()
    return row


def update_goal(ctx: Ctx, goal_id: uuid.UUID, data: GoalUpdate) -> Goal:
    """``saveGoal`` with an id: edit the fields given."""
    row = require_goal(ctx, goal_id)
    patch = data.model_dump(exclude_unset=True)
    for k in ("metric", "label", "target", "comparator", "period", "unit"):
        if k in patch and patch[k] is None:
            raise invalid("goal_field_required", "That field can't be empty")
    _check_goal(patch.get("metric"), patch.get("target"))
    owned_repo.apply(row, patch)
    _save(ctx, row)
    ctx.commit()
    return row


def set_goal_status(ctx: Ctx, goal_id: uuid.UUID, status: str) -> Goal:
    """``archiveGoal`` / ``restoreGoal``."""
    row = require_goal(ctx, goal_id)
    row.status = status
    _save(ctx, row)
    ctx.commit()
    return row


def delete_goal(ctx: Ctx, goal_id: uuid.UUID) -> None:
    """``deleteGoal``: a tombstone (sync ships it; undo restores it)."""
    owned_repo.soft_delete(ctx, require_goal(ctx, goal_id))
    ctx.commit()


def restore_deleted_goal(ctx: Ctx, goal_id: uuid.UUID) -> Goal:
    row = owned_repo.require(ctx, Goal, goal_id, what="goal", include_deleted=True)
    owned_repo.restore(ctx, row)
    ctx.commit()
    return row


# ---------------------------------------------------------------- reviews


def _review_key(key: str) -> str:
    if D.review_period(key) is None:
        raise invalid(
            "review_key_invalid", "A review is a week (Monday) or a month (1st)"
        )
    return key


def save_review(ctx: Ctx, key: str, data: ReviewIn) -> Review:
    """``saveReview``: merge the patch into the period's review (created on
    first save). With ``journal`` and a reflection, the reflection is also
    added to the journal."""
    _review_key(key)
    if data.focus is not None and data.focus and not D.valid_metric_ref(data.focus):
        raise invalid("review_focus_invalid", "That metric can't be a focus")
    patch = data.model_dump(exclude_unset=True, exclude={"journal"})
    row = owned_repo.find_one(ctx, Review, col(Review.key) == key, include_deleted=True)
    if row is None:
        row = _insert(ctx, Review, {"key": key, "done": False})
    row.deleted_at = None
    if patch.get("done") and row.done_at is None:
        row.done_at = ctx.now
    owned_repo.apply(row, patch)
    _save(ctx, row)
    if data.journal and (data.reflection or "").strip():
        capture_public.add_journal_entry(
            ctx, body=(data.reflection or "").strip(), source="text", day=ctx.today
        )
    ctx.commit()
    return row


def list_reviews(ctx: Ctx, *, skip: int, limit: int) -> tuple[list[Review], int]:
    rows = owned_repo.list_rows(
        ctx, Review, order_by=(col(Review.key).desc(),), skip=skip, limit=limit
    )
    return rows, owned_repo.count_rows(ctx, Review)


# ---------------------------------------------------------------- wrap-up


def wrap_up_for(ctx: Ctx, day: date) -> WrapUp | None:
    return owned_repo.find_one(ctx, WrapUp, col(WrapUp.day) == day)


def is_evening(ctx: Ctx) -> bool:
    profile = profile_public.get_profile(ctx)
    try:
        h, m = parse_hm(profile.evening_start)
    except ValueError:
        h, m = 18, 0
    local = ctx.now.astimezone(ctx.clock.zone)
    # Past midnight but before the day rolls over is still the evening.
    return local.time() >= time(h, m) or local.hour < ctx.clock.start_hour


def seal_day(ctx: Ctx, data: SealIn) -> WrapUp:
    """``sealDay``: record the day's ring as it stands and the reflection.
    Re-sealing updates the record; a reflection also goes to the journal."""
    day = data.day or ctx.today
    if day > ctx.today:
        raise invalid("wrapup_future", "You can't wrap up a day that hasn't started")
    ring = stats_public.day_ring(ctx, day=day)
    reflection = (data.reflection or "").strip() or None
    row = owned_repo.find_one(ctx, WrapUp, col(WrapUp.day) == day, include_deleted=True)
    values: dict[str, Any] = {
        "day": day,
        "at": ctx.now,
        "on_target": ring.on_target,
        "done": ring.done,
        "due": ring.due,
        "reflection": reflection,
    }
    if row is None:
        row = _insert(ctx, WrapUp, values, data.id)
    else:
        owned_repo.apply(row, values)
        row.deleted_at = None
        _save(ctx, row)
    if reflection:
        entry = capture_public.add_journal_entry(
            ctx, body=reflection, source="wrapup", day=day
        )
        row.journal_entry_id = entry.id
        _save(ctx, row)
    stats_public.mark_dirty(ctx, module=STATS_MODULE, day=day)
    ctx.commit()
    return row


def unseal_day(ctx: Ctx, day: date) -> None:
    """``unsealDay``: reopen the day (the wrap-up is tombstoned)."""
    row = wrap_up_for(ctx, day)
    if row is None:
        raise not_found("wrap_up")
    owned_repo.soft_delete(ctx, row)
    stats_public.mark_dirty(ctx, module=STATS_MODULE, day=day)
    ctx.commit()


def wrap_action(ctx: Ctx, data: WrapActionIn) -> None:
    """One wrap-up row action: tick a task, move it to tomorrow, check a
    habit, or skip a habit ("didn't happen"). Through the owning module's
    public functions."""
    day = data.day or ctx.today
    if data.kind == "complete_task":
        tasks_public.complete_task(ctx, task_id=data.id)
    elif data.kind == "move_task_tomorrow":
        tasks_public.reschedule_by(ctx, task_id=data.id, days=1)
    elif data.kind == "check_habit":
        habits_public.log_habit(
            ctx, habit_id=data.id, day=day, status="done", source="tap"
        )
    else:
        habits_public.log_habit(
            ctx,
            habit_id=data.id,
            day=day,
            status="skipped",
            note=data.note or "wrap-up: didn't happen",
        )
    ctx.commit()


# ---------------------------------------------------------------- inbox


def list_notifications(
    ctx: Ctx, *, skip: int, limit: int
) -> tuple[list[Notification], int, int]:
    rows = owned_repo.list_rows(
        ctx,
        Notification,
        order_by=(col(Notification.at).desc(), col(Notification.id)),
        skip=skip,
        limit=limit,
    )
    total = owned_repo.count_rows(ctx, Notification)
    unread = owned_repo.count_rows(ctx, Notification, col(Notification.read).is_(False))
    return rows, total, unread


def mark_read(ctx: Ctx, notification_id: uuid.UUID, read: bool = True) -> Notification:
    row = owned_repo.require(ctx, Notification, notification_id, what="notification")
    row.read = read
    _save(ctx, row)
    ctx.commit()
    return row


def mark_all_read(ctx: Ctx) -> int:
    rows = owned_repo.list_rows(ctx, Notification, col(Notification.read).is_(False))
    for row in rows:
        row.read = True
        row.updated_at = ctx.now
        ctx.session.add(row)
    ctx.session.flush()
    ctx.commit()
    return len(rows)


def dismiss(ctx: Ctx, notification_id: uuid.UUID) -> None:
    """Swipe away: a tombstone, so undo can bring it back."""
    owned_repo.soft_delete(
        ctx, owned_repo.require(ctx, Notification, notification_id, what="notification")
    )
    ctx.commit()


def undismiss(ctx: Ctx, notification_id: uuid.UUID) -> Notification:
    row = owned_repo.require(
        ctx, Notification, notification_id, what="notification", include_deleted=True
    )
    owned_repo.restore(ctx, row)
    ctx.commit()
    return row


def note_miss(ctx: Ctx, miss_key: str, note: str) -> MissNote | None:
    """``noteMiss``: a blank note removes it."""
    text = note.strip()
    row = owned_repo.find_one(
        ctx, MissNote, col(MissNote.miss_key) == miss_key, include_deleted=True
    )
    if not text:
        if row is not None and row.deleted_at is None:
            owned_repo.soft_delete(ctx, row)
        ctx.commit()
        return None
    if row is None:
        row = _insert(ctx, MissNote, {"miss_key": miss_key, "note": text})
    else:
        row.note = text
        row.deleted_at = None
        _save(ctx, row)
    ctx.commit()
    return row


# ---------------------------------------------------------------- share


def share_defaults(ctx: Ctx) -> dict[str, dict[str, bool]]:
    saved = {r.template: r.fields for r in owned_repo.list_rows(ctx, ShareDefault)}
    return {t: D.resolve_fields(t, saved.get(t)) for t in D.TEMPLATES}


def save_share_defaults(
    ctx: Ctx, template: str, fields: dict[str, bool]
) -> ShareDefault:
    """``saveShareDefaults``: replace the template's saved field choices."""
    if template not in D.TEMPLATES:
        raise not_found("share_template")
    if D.unknown_fields(template, fields):
        raise invalid("share_field_unknown", "That card has no such field")
    row = owned_repo.find_one(
        ctx, ShareDefault, col(ShareDefault.template) == template, include_deleted=True
    )
    if row is None:
        row = _insert(ctx, ShareDefault, {"template": template, "fields": dict(fields)})
    else:
        row.fields = dict(fields)
        row.deleted_at = None
        _save(ctx, row)
    ctx.commit()
    return row


def _metric(
    metrics: dict[str, list[Any]], module: str, key: str
) -> dict[str, Any] | None:
    m = next((x for x in metrics.get(module, []) if x.key == key), None)
    if m is None:
        return None
    return {"label": m.label, "value": m.value, "delta": m.delta}


def share_card(ctx: Ctx, template: str, goal_id: uuid.UUID | None) -> dict[str, Any]:
    """``useCardData`` for one template, with the user's field choices
    applied: a field that is off (handle, photo, identity statements) is not
    sent at all. Money amounts never leave (IA X-5)."""
    if template not in D.TEMPLATES:
        raise not_found("share_template")
    fields = share_defaults(ctx)[template]
    cs = stats_public.card_stats(ctx)
    profile = profile_public.get_profile(ctx)
    case = stats_public.trophy_case(ctx)
    goals = stats_public.goals_with_progress(ctx)
    goal = (
        next(
            (g for g in goals if goal_id is not None and g.goal.id == str(goal_id)),
            None,
        )
        or next(
            (g for g in goals if g.goal.status == "active" and g.progress.hit), None
        )
        or next((g for g in goals if g.goal.status == "active"), None)
    )
    life = cs.life30
    m7, m30 = cs.metrics7, cs.metrics30
    budgets = _metric(m30, "finance", "budgets")

    def target(t: stats_public.OnTarget) -> dict[str, Any]:
        return {
            "rate": t.rate,
            "prev_rate": t.prev_rate,
            "current": t.current,
            "best": t.best,
            "days": [
                {"day": d.day.isoformat(), "on_target": d.on_target} for d in t.range
            ],
        }

    def facet(f: stats_public.FacetView) -> dict[str, Any]:
        return {
            "key": f.key, "label": f.label, "module": f.module, "value": f.value,
            "prev": f.prev, "off": f.off,
        }  # fmt: skip

    def trophy(t: stats_public.Trophy) -> dict[str, Any]:
        return {
            "id": t.id, "type": t.type, "title": t.title, "value": t.value,
            "detail": t.detail, "day": t.day.isoformat(),
        }  # fmt: skip

    data: dict[str, Any] = {
        "name": profile.name,
        "enabled": cs.enabled,
        "life": {
            "score": life.life_score,
            "delta": life.delta,
            "level": life.level,
            "areas": [
                {"module": a.module, "rate": a.rate, "enabled": a.enabled}
                for a in life.areas
            ],
        },
        "w7": target(cs.target7),
        "w30": target(cs.target30),
        "habits7": _metric(m7, "habits", "habits.rate"),
        "training7": _metric(m7, "fitness", "sessions"),
        "savings7": _metric(m7, "finance", "savings-rate"),
        "habits30": _metric(m30, "habits", "habits.rate"),
        "training30": _metric(m30, "fitness", "sessions"),
        "savings30": _metric(m30, "finance", "savings-rate"),
        "prs30": _metric(m30, "fitness", "prs"),
        "spend30": _metric(m30, "finance", "spend-vs"),
        "nospend30": _metric(m30, "finance", "no-spend"),
        "budgets_pct": D.budgets_pct(budgets["value"]) if budgets else None,
        "trophy": trophy(case.trophies[0]) if case.trophies else None,
        "trophies": [trophy(t) for t in case.trophies[:3]],
        "goal": {
            "id": goal.goal.id,
            "label": goal.label,
            "target": goal.goal.target,
            "unit": goal.goal.unit,
            "comparator": goal.goal.comparator,
            "period": goal.goal.period,
            "value": goal.entry.value if goal.entry else None,
            "pct": goal.progress.pct,
            "hit": goal.progress.hit,
        }
        if goal
        else None,
        "facets7": [facet(f) for f in cs.facets7],
        "facets30": [facet(f) for f in cs.facets30],
    }
    if fields.get("handle"):
        data["handle"] = profile.handle
    if template == "profile":
        if fields.get("photo"):
            data["photo_media_id"] = (
                str(profile.photo_media_id) if profile.photo_media_id else None
            )
        if fields.get("identity"):
            from app.modules.profile.models import Identity

            data["identities"] = [
                i.text
                for i in owned_repo.list_rows(
                    ctx, Identity, order_by=(col(Identity.sort_order),)
                )
            ]
    scrubbed: dict[str, Any] = D.scrub_money(data)
    return {"template": template, "fields": fields, "data": scrubbed}


# ---------------------------------------------------------------- onboarding


def onboarding(ctx: Ctx, data: OnboardingIn) -> tuple[list[Goal], list[str]]:
    """The onboarding finish: a starter goal per chosen module at the chosen
    pace, unless an active goal on that metric already exists. Identities,
    enabled modules, push times and the onboarded flag are profile writes
    (``/profile``)."""
    pace = D.PACES[data.pace]
    existing = {
        g.metric for g in owned_repo.list_rows(ctx, Goal, col(Goal.status) == "active")
    }
    created: list[Goal] = []
    skipped: list[str] = []
    for k in dict.fromkeys(data.modules):
        starter = D.STARTERS[k]
        if starter.metric in existing:
            skipped.append(k)
            continue
        target = data.targets.get(k, pace.targets[k])
        _check_goal(None, target)
        created.append(
            _insert(
                ctx,
                Goal,
                {
                    "metric": starter.metric,
                    "label": starter.label,
                    "target": target,
                    "unit": starter.unit,
                    "comparator": starter.comparator,
                    "period": starter.period,
                    "status": "active",
                    "via": "onboarding",
                },
            )
        )
    ctx.commit()
    return created, skipped


# ---------------------------------------------------------------- today


def unread_count(ctx: Ctx) -> int:
    return owned_repo.count_rows(ctx, Notification, col(Notification.read).is_(False))


def today_bundle(ctx: Ctx) -> dict[str, Any]:
    """Everything the Today screen's header and cards count, in one read."""
    ov = stats_public.overview(ctx, days=7)
    ring = stats_public.day_ring(ctx)
    items = stats_public.calendar(ctx, first=ctx.today, last=ctx.today)
    yesterday = ctx.today - timedelta(days=1)
    misses = stats_public.misses(ctx, first=yesterday, last=yesterday)
    case = stats_public.trophy_case(ctx)
    goals = [
        g
        for g in stats_public.goals_with_progress(ctx)
        if g.goal.status == "active" and not g.hidden
    ]
    now_hm = ctx.now.astimezone(ctx.clock.zone).strftime("%H:%M")
    open_items = [i for i in items if not i.done]
    upcoming = [i for i in open_items if i.time is None or i.time >= now_hm]
    nxt = (upcoming or open_items)[0] if open_items else None
    top = case.trophies[0] if case.trophies else None
    return {
        "day": ctx.today,
        "ring": {
            "due": ring.due,
            "done": ring.done,
            "per": {k: {"due": d, "done": n} for k, (d, n) in ring.per.items()},
        },
        "threshold": ring.threshold,
        "on_target_now": ring.on_target,
        "life_score": ov.life_score,
        "level": ov.level or "",
        "delta": ov.delta,
        "streak": ov.streak,
        "next_up": {
            "id": nxt.id,
            "title": nxt.title,
            "module": nxt.module,
            "time": nxt.time,
            "href": nxt.href,
        }
        if nxt
        else None,
        "counts": {
            "items": len(items),
            "items_done": sum(1 for i in items if i.done),
            "misses_yesterday": len(misses),
            "unread": unread_count(ctx),
            "goals_active": len(goals),
            "goals_hit": sum(1 for g in goals if g.progress.hit),
            "trophies_unseen": sum(1 for t in case.trophies if t.id not in case.seen),
        },
        "wrap_up": wrap_up_for(ctx, ctx.today),
        "evening": is_evening(ctx),
        "top_trophy": {
            "id": top.id,
            "type": top.type,
            "title": top.title,
            "value": top.value,
            "detail": top.detail,
            "day": top.day,
            "href": top.href,
            "share_ref": top.share_ref,
            "seen": top.id in case.seen,
        }  # fmt: skip
        if top
        else None,
    }


# ---------------------------------------------------------------- helpers


def _insert(
    ctx: Ctx, model: type[R], values: dict[str, Any], row_id: uuid.UUID | None = None
) -> R:
    """Insert in a savepoint: an id another user already holds is a 409."""
    savepoint = ctx.session.begin_nested()
    try:
        row = owned_repo.insert(ctx, model, values, row_id=row_id)
    except IntegrityError as exc:
        savepoint.rollback()
        raise conflict("id_conflict", "That id is already in use") from exc
    savepoint.commit()
    return row


def _save(ctx: Ctx, row: Any) -> None:
    row.updated_at = ctx.now
    ctx.session.add(row)
    ctx.session.flush()
