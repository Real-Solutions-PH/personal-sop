"""Write use cases of the habits module, ported from
``shared/prototype/habits/actions.ts``.

Functions without a leading underscore are use cases: keyword-only ``ctx``,
ending in ``ctx.commit()``. The ``_``-prefixed helpers only flush; they are
what ``public.py`` exposes to other modules.

Decisions recorded here (each overridable in one place):

- A log is unique per (habit, day): re-logging edits the row, and a log that
  was undone (tombstoned) is revived with the new values, keeping its id.
- Logging a day after today is refused (``log_day_in_future``); backfilling
  any past day is allowed (F-HAB-06).
- Starting a routine abandons any other unfinished run the user has: the
  schema allows one in-progress run per user, and a run from an earlier day
  is already abandoned by the prototype's own reading (``runState``). The
  Live-bar check runs first, so a routine that is still on the bar is never
  abandoned this way: the start fails with 409 ``live_session_busy``.
- Exiting the player releases the Live bar but keeps the run in progress, so
  it is resumable until the day ends (F-HAB-27).
- A habit with a screen-time rule completes itself: every manual way to log,
  skip, clear or time it is refused with 409 ``habit_auto``
  (:func:`_require_manual`). Its only logs are the phone's ``source="screen"``
  ones, synced under a derived id; such a log never overwrites a log the
  day already has from before the rule.
- While the user's Screen time switch is off, a rule habit is an ordinary
  habit: manual actions are accepted, and a ``source="screen"`` log is
  refused with 409 ``screen_off``. No log is deleted either way.
"""

import uuid
from datetime import date, timedelta
from typing import Any, Literal

from sqlmodel import col, func, select

from app.modules.habits import logic as L
from app.modules.habits.models import (
    Habit,
    HabitLog,
    HabitPause,
    HabitSettings,
    HabitTimer,
    Routine,
    RoutineRun,
    RoutineStep,
    RoutineStepResult,
)
from app.modules.habits.schema import (
    EVERY_DAY,
    HabitCreate,
    HabitSyncIn,
    HabitUpdate,
    RoutineCreate,
    RoutineSyncIn,
    RoutineUpdate,
    SettingsIn,
    StepIn,
)
from app.modules.profile import public as profile
from app.modules.screen import public as screen_public
from app.modules.stats import public as stats
from app.shared import owned_repo
from app.shared.context import Ctx
from app.shared.domain import conflict, invalid, not_found
from app.shared.ids import derived_id

MODULE = "habits"
LogStatusT = Literal["done", "partial", "skipped"]


def timer_href(habit_id: uuid.UUID) -> str:
    return f"/habits/{habit_id}/timer"


def player_href(routine_id: uuid.UUID) -> str:
    return f"/habits/routines/{routine_id}/play"


def _dirty(ctx: Ctx, day: date) -> None:
    stats.mark_dirty(ctx, module=MODULE, day=day)


def mark_today(ctx: Ctx) -> None:
    _dirty(ctx, ctx.today)


def require_habit(ctx: Ctx, habit_id: uuid.UUID) -> Habit:
    return owned_repo.require(ctx, Habit, habit_id, what="habit")


def require_routine(ctx: Ctx, routine_id: uuid.UUID) -> Routine:
    return owned_repo.require(ctx, Routine, routine_id, what="routine")


def _screen_on(ctx: Ctx) -> bool:
    """The caller's own Screen time switch."""
    return profile.module_settings(ctx)["screen"].enabled


def _require_manual(ctx: Ctx, habit: Habit) -> None:
    """A habit with a screen-time rule completes itself: no manual action.
    While the caller's Screen time is switched off it is an ordinary habit."""
    if habit.rule_kind is not None and _screen_on(ctx):
        raise conflict(
            "habit_auto", "This habit completes itself from your screen time"
        )


RULE_FIELDS = ("rule_kind", "rule_group_id", "rule_max_min")


def _check_rule(ctx: Ctx, existing: Habit | None, values: dict[str, Any]) -> None:
    """A rule is all three fields or none, on a check habit, pointing at one
    of the caller's live screen-time groups when it starts pointing there."""

    def after(key: str, default: Any = None) -> Any:
        if key in values:
            return values[key]
        return getattr(existing, key) if existing is not None else default

    kind, group_id, max_min = (after(k) for k in RULE_FIELDS)
    present = [v is not None for v in (kind, group_id, max_min)]
    if any(present) and not all(present):
        raise invalid(
            "habit_rule_incomplete", "A screen-time rule needs a group and a limit"
        )
    if kind is None:
        return
    if after("type", "check") != "check":
        raise invalid(
            "habit_rule_type", "A habit that completes from screen time is a check"
        )
    if existing is None or existing.rule_group_id != group_id:
        screen_public.require_live_group(ctx, group_id)


def _dump_schedule(slots: list[Any] | None) -> list[dict[str, object]] | None:
    if slots is None:
        return None
    return [s.model_dump(exclude_none=True) for s in slots]


# ---------------------------------------------------------------- settings


def settings_id(ctx: Ctx) -> uuid.UUID:
    return derived_id("habit-settings", ctx.user_id, "settings")


def get_settings(ctx: Ctx) -> HabitSettings:
    """The caller's settings; an unsaved default row when never changed (a
    read never writes)."""
    row = owned_repo.find_one(ctx, HabitSettings)
    return row or HabitSettings(id=settings_id(ctx), **ctx.owned())


def _save_settings(ctx: Ctx, data: dict[str, Any]) -> HabitSettings:
    row = owned_repo.find_one(ctx, HabitSettings, include_deleted=True)
    if row is None:
        return owned_repo.insert(ctx, HabitSettings, data, row_id=settings_id(ctx))
    owned_repo.apply(row, data)
    row.deleted_at = None
    ctx.session.add(row)
    ctx.session.flush()
    return row


def update_settings(ctx: Ctx, *, patch: SettingsIn) -> HabitSettings:
    row = _save_settings(ctx, patch.model_dump(exclude_unset=True, exclude_none=True))
    ctx.commit()
    return row


# ---------------------------------------------------------------- logging


def _find_log(
    ctx: Ctx, habit_id: uuid.UUID, day: date, *, include_deleted: bool = False
) -> HabitLog | None:
    return owned_repo.find_one(
        ctx,
        HabitLog,
        col(HabitLog.habit_id) == habit_id,
        col(HabitLog.day) == day,
        include_deleted=include_deleted,
    )


def _log(
    ctx: Ctx,
    *,
    habit: Habit,
    day: date | None = None,
    value: float | None = None,
    add: bool = False,
    status: LogStatusT | None = None,
    source: str = "tap",
    note: str | None = None,
    log_id: uuid.UUID | None = None,
) -> HabitLog:
    """Create-or-edit the (habit, day) log (``logHabit``). Flushes only."""
    _require_manual(ctx, habit)
    the_day = day or ctx.today
    if the_day > ctx.today:
        raise invalid("log_day_in_future", "You can't log a day that hasn't happened")
    row = _find_log(ctx, habit.id, the_day, include_deleted=True)
    live = row if row is not None and row.deleted_at is None else None
    if add and live is not None and live.value is not None and value is not None:
        value = live.value + value
    final = status or L.auto_status(habit.type, habit.target, value)
    data: dict[str, Any] = {
        "habit_id": habit.id,
        "day": the_day,
        "status": final,
        "value": None if final == "skipped" else value,
        "note": note if note is not None else (live.note if live else None),
        "logged_at": ctx.now,
        "source": source,
    }
    if row is not None:
        owned_repo.apply(row, data)
        row.deleted_at = None
        ctx.session.add(row)
        ctx.session.flush()
    else:
        row = owned_repo.insert(ctx, HabitLog, data, row_id=log_id or uuid.uuid4())
    _dirty(ctx, the_day)
    return row


def _check(
    ctx: Ctx,
    *,
    habit: Habit,
    day: date | None = None,
    source: str = "tap",
    log_id: uuid.UUID | None = None,
) -> HabitLog:
    value = None if habit.type == "check" else (habit.target or 1)
    return _log(
        ctx,
        habit=habit,
        day=day,
        status="done",
        value=value,
        source=source,
        log_id=log_id,
    )


def log_habit(
    ctx: Ctx,
    *,
    habit_id: uuid.UUID,
    day: date | None = None,
    value: float | None = None,
    add: bool = False,
    status: LogStatusT | None = None,
    source: str = "tap",
    note: str | None = None,
    log_id: uuid.UUID | None = None,
) -> HabitLog:
    row = _log(
        ctx,
        habit=require_habit(ctx, habit_id),
        day=day,
        value=value,
        add=add,
        status=status,
        source=source,
        note=note,
        log_id=log_id,
    )
    ctx.commit()
    return row


def check_habit(
    ctx: Ctx, *, habit_id: uuid.UUID, day: date | None = None, source: str = "tap"
) -> HabitLog:
    row = _check(ctx, habit=require_habit(ctx, habit_id), day=day, source=source)
    ctx.commit()
    return row


def increment_count(
    ctx: Ctx, *, habit_id: uuid.UUID, by: float | None = None, day: date | None = None
) -> HabitLog:
    habit = require_habit(ctx, habit_id)
    row = _log(ctx, habit=habit, day=day, value=by or habit.step or 1, add=True)
    ctx.commit()
    return row


def skip_habit(
    ctx: Ctx, *, habit_id: uuid.UUID, day: date | None = None, note: str | None = None
) -> HabitLog:
    row = _log(
        ctx, habit=require_habit(ctx, habit_id), day=day, status="skipped", note=note
    )
    ctx.commit()
    return row


def clear_log(ctx: Ctx, *, habit_id: uuid.UUID, day: date | None = None) -> HabitLog:
    """Undo the (habit, day) log. Returns the removed log for an undo toast."""
    _require_manual(ctx, require_habit(ctx, habit_id))
    the_day = day or ctx.today
    row = _find_log(ctx, habit_id, the_day)
    if row is None:
        raise not_found("habit_log")
    owned_repo.soft_delete(ctx, row)
    _dirty(ctx, the_day)
    ctx.commit()
    return row


def _delete_log(ctx: Ctx, *, log_id: uuid.UUID) -> None:
    row = owned_repo.require(ctx, HabitLog, log_id, what="habit_log")
    habit = owned_repo.get(ctx, Habit, row.habit_id)
    if habit is not None:
        _require_manual(ctx, habit)
    owned_repo.soft_delete(ctx, row)
    _dirty(ctx, row.day)


def delete_log(ctx: Ctx, *, log_id: uuid.UUID) -> None:
    _delete_log(ctx, log_id=log_id)
    ctx.commit()


def _restore_log(ctx: Ctx, *, log_id: uuid.UUID) -> HabitLog:
    row = owned_repo.require(
        ctx, HabitLog, log_id, what="habit_log", include_deleted=True
    )
    habit = require_habit(ctx, row.habit_id)
    if row.source != "screen":
        _require_manual(ctx, habit)
    owned_repo.restore(ctx, row)
    _dirty(ctx, row.day)
    return row


def restore_log(ctx: Ctx, *, log_id: uuid.UUID) -> HabitLog:
    row = _restore_log(ctx, log_id=log_id)
    ctx.commit()
    return row


def set_day(
    ctx: Ctx, *, day: date, entries: list[tuple[uuid.UUID, Any, Any, Any]]
) -> list[HabitLog]:
    """The day editor: set (status, value, note) per habit, ``status`` None
    clears that habit's log. One transaction for the whole day."""
    if day > ctx.today:
        raise invalid("log_day_in_future", "You can't log a day that hasn't happened")
    out: list[HabitLog] = []
    for habit_id, status, value, note in entries:
        habit = require_habit(ctx, habit_id)
        if status is None:
            existing = _find_log(ctx, habit_id, day)
            if existing is not None:
                _require_manual(ctx, habit)
                owned_repo.soft_delete(ctx, existing)
            continue
        out.append(
            _log(ctx, habit=habit, day=day, status=status, value=value, note=note)
        )
    _dirty(ctx, day)
    ctx.commit()
    return out


def upsert_log_sync(ctx: Ctx, row_id: uuid.UUID, data: dict[str, Any]) -> HabitLog:
    """Sync upsert of a ``habit_log``: field-level LWW on the (habit, day)
    natural key, so an offline log for a day the server already holds edits
    that row (or revives its tombstone) instead of tripping the unique key."""
    existing = owned_repo.get(ctx, HabitLog, row_id, include_deleted=True)
    habit_id = data.get("habit_id") or (existing.habit_id if existing else None)
    day = data.get("day") or (existing.day if existing else None)
    if habit_id is None or day is None:
        raise invalid("missing_fields", "A log needs a habit and a day")
    habit = require_habit(ctx, habit_id)
    if day > ctx.today:
        raise invalid("log_day_in_future", "You can't log a day that hasn't happened")
    source = data.get("source") or (existing.source if existing else "tap")
    if habit.rule_kind is None:
        if source == "screen":
            raise invalid(
                "screen_source_mismatch",
                "Only a habit with a screen-time rule completes from screen time",
            )
    elif source != "screen":
        _require_manual(ctx, habit)
    else:
        if not _screen_on(ctx):
            raise conflict("screen_off", "Screen time is switched off for this account")
        # The reconciler only fills a day with no log: one that predates the
        # rule (a tap, say) stands, and the replay lands on it unchanged.
        current = existing if existing is not None else _find_log(ctx, habit_id, day)
        if (
            current is not None
            and current.deleted_at is None
            and current.source != "screen"
        ):
            return current
    data = {**data, "habit_id": habit_id, "day": day}
    if existing is None:
        data.setdefault("logged_at", ctx.now)
        data.setdefault("source", "tap")
    if data.get("status") == "skipped":
        data["value"] = None
    row, _ = owned_repo.upsert(
        ctx, HabitLog, row_id, data, natural_key=("habit_id", "day")
    )
    _dirty(ctx, day)
    return row


# ---------------------------------------------------------------- habit CRUD


def _next_sort_order(ctx: Ctx) -> int:
    top = ctx.session.exec(
        select(func.max(Habit.sort_order)).where(
            col(Habit.owner_id) == ctx.user_id, col(Habit.deleted_at).is_(None)
        )
    ).one()
    return max(0, int(top or 0)) + 1


def _create_habit(ctx: Ctx, *, data: HabitCreate) -> Habit:
    if data.id is not None:
        existing = owned_repo.get(ctx, Habit, data.id, include_deleted=True)
        if existing is not None:
            if existing.deleted_at is not None:
                raise conflict("habit_deleted", "That habit was deleted")
            return existing  # a replayed create
    fields = data.model_dump(exclude={"id", "schedule"}, exclude_none=True)
    schedule = _dump_schedule(data.schedule) or [{"days": EVERY_DAY}]
    row = owned_repo.insert(
        ctx,
        Habit,
        {
            "icon": "✅",
            "reminder": get_settings(ctx).default_reminder,
            **fields,
            "schedule": schedule,
            "status": "active",
            "sort_order": _next_sort_order(ctx),
        },
        row_id=data.id,
    )
    _dirty(ctx, ctx.today)
    return row


def create_habit(ctx: Ctx, *, data: HabitCreate) -> Habit:
    row = _create_habit(ctx, data=data)
    ctx.commit()
    return row


def update_habit(ctx: Ctx, *, habit_id: uuid.UUID, patch: HabitUpdate) -> Habit:
    row = require_habit(ctx, habit_id)
    values = patch.model_dump(exclude_unset=True, exclude={"schedule"})
    if patch.schedule is not None:
        values["schedule"] = _dump_schedule(patch.schedule)
    for key in ("name", "icon", "type", "reminder", "link_workout", "sort_order"):
        if key in values and values[key] is None:
            raise invalid("field_required", "That field can't be empty")
    _check_rule(ctx, row, values)
    owned_repo.apply(row, values)
    ctx.session.add(row)
    ctx.session.flush()
    _dirty(ctx, ctx.today)
    ctx.commit()
    return row


def upsert_habit_sync(ctx: Ctx, row_id: uuid.UUID, payload: HabitSyncIn) -> Habit:
    values = payload.model_dump(exclude_unset=True, exclude={"schedule"})
    if payload.schedule is not None:
        values["schedule"] = _dump_schedule(payload.schedule)
    existing = owned_repo.get(ctx, Habit, row_id, include_deleted=True)
    _check_rule(ctx, existing, values)
    if existing is None:
        values.setdefault("sort_order", _next_sort_order(ctx))
        values.setdefault("schedule", [{"days": EVERY_DAY}])
    row, _ = owned_repo.upsert(ctx, Habit, row_id, values)
    _dirty(ctx, ctx.today)
    return row


def _pauses(ctx: Ctx, habit_id: uuid.UUID) -> list[HabitPause]:
    return owned_repo.list_rows(
        ctx,
        HabitPause,
        col(HabitPause.habit_id) == habit_id,
        order_by=(col(HabitPause.from_day),),
    )


def pause_habit(
    ctx: Ctx,
    *,
    habit_id: uuid.UUID,
    until: date | None = None,
    reason: str | None = None,
) -> Habit:
    """Pause from today; ``until`` is the day it auto-resumes (exclusive)."""
    row = require_habit(ctx, habit_id)
    today = ctx.today
    to_day = until - timedelta(days=1) if until else None
    if to_day is not None and to_day < today:
        raise invalid("pause_until_past", "Pick a resume day after today")
    owned_repo.insert(
        ctx,
        HabitPause,
        {"habit_id": row.id, "from_day": today, "to_day": to_day, "reason": reason},
    )
    row.status = "paused"
    ctx.session.add(row)
    ctx.session.flush()
    _dirty(ctx, today)
    ctx.commit()
    return row


def resume_habit(ctx: Ctx, *, habit_id: uuid.UUID) -> Habit:
    """Close the pause covering today at yesterday; a pause that started
    today is removed entirely."""
    row = require_habit(ctx, habit_id)
    today = ctx.today
    yesterday = today - timedelta(days=1)
    for p in _pauses(ctx, habit_id):
        if today >= p.from_day and (p.to_day is None or today <= p.to_day):
            if yesterday < p.from_day:
                owned_repo.soft_delete(ctx, p)
            else:
                p.to_day = yesterday
                ctx.session.add(p)
    row.status = "active"
    ctx.session.add(row)
    ctx.session.flush()
    _dirty(ctx, today)
    ctx.commit()
    return row


def archive_habit(ctx: Ctx, *, habit_id: uuid.UUID) -> Habit:
    row = require_habit(ctx, habit_id)
    row.status = "archived"
    row.archived_at = ctx.now
    ctx.session.add(row)
    ctx.session.flush()
    _dirty(ctx, ctx.today)
    ctx.commit()
    return row


def restore_habit(ctx: Ctx, *, habit_id: uuid.UUID) -> Habit:
    row = require_habit(ctx, habit_id)
    row.status = "active"
    row.archived_at = None
    ctx.session.add(row)
    ctx.session.flush()
    _dirty(ctx, ctx.today)
    ctx.commit()
    return row


def _delete_habit(ctx: Ctx, habit_id: uuid.UUID) -> None:
    row = require_habit(ctx, habit_id)
    days: set[date] = {ctx.today}
    for lg in owned_repo.list_rows(ctx, HabitLog, col(HabitLog.habit_id) == habit_id):
        days.add(lg.day)
        owned_repo.soft_delete(ctx, lg)
    for p in _pauses(ctx, habit_id):
        owned_repo.soft_delete(ctx, p)
    # Removed from every routine; the remaining steps close ranks.
    routine_ids = {
        s.routine_id
        for s in owned_repo.list_rows(
            ctx, RoutineStep, col(RoutineStep.habit_id) == habit_id
        )
    }
    for rid in routine_ids:
        kept = [
            StepIn(habit_id=s.habit_id, minutes=s.minutes)
            for s in _steps(ctx, rid)
            if s.habit_id != habit_id
        ]
        _write_steps(ctx, rid, kept)
    timer = owned_repo.find_one(ctx, HabitTimer, col(HabitTimer.habit_id) == habit_id)
    if timer is not None:
        owned_repo.soft_delete(ctx, timer)
        profile.end_live(ctx, kind="timer", ref_id=habit_id)
    owned_repo.soft_delete(ctx, row)
    for d in days:
        _dirty(ctx, d)


def delete_habit(ctx: Ctx, *, habit_id: uuid.UUID) -> None:
    """Delete a habit, its logs and pauses, and drop it from every routine."""
    _delete_habit(ctx, habit_id)
    ctx.commit()


def reorder_habit(ctx: Ctx, *, habit_id: uuid.UUID, direction: int) -> list[Habit]:
    """Swap with the neighbour in manual order (``reorderHabit``); moving past
    either end is a no-op."""
    require_habit(ctx, habit_id)
    items = sorted(
        owned_repo.list_rows(ctx, Habit, col(Habit.status) != "archived"),
        key=lambda h: h.sort_order,
    )
    i = next((k for k, h in enumerate(items) if h.id == habit_id), -1)
    j = i + direction
    if 0 <= i and 0 <= j < len(items):
        a, b = items[i], items[j]
        a.sort_order, b.sort_order = b.sort_order, a.sort_order
        if a.sort_order == b.sort_order:  # equal orders: make the move visible
            a.sort_order += direction
        ctx.session.add(a)
        ctx.session.add(b)
        ctx.session.flush()
    ctx.commit()
    return sorted(items, key=lambda h: h.sort_order)


# ---------------------------------------------------------------- routines


def _steps(ctx: Ctx, routine_id: uuid.UUID) -> list[RoutineStep]:
    return owned_repo.list_rows(
        ctx,
        RoutineStep,
        col(RoutineStep.routine_id) == routine_id,
        order_by=(col(RoutineStep.position),),
    )


def step_id(routine_id: uuid.UUID, position: int) -> uuid.UUID:
    return derived_id("routine-step", routine_id, str(position))


def _write_steps(ctx: Ctx, routine_id: uuid.UUID, steps: list[StepIn]) -> None:
    """Replace the step list. Rows are reused by position (live or
    tombstoned) because ``(routine_id, position)`` is unique across
    tombstones too; positions past the new end are tombstoned."""
    for s in steps:
        require_habit(ctx, s.habit_id)
    rows = owned_repo.list_rows(
        ctx,
        RoutineStep,
        col(RoutineStep.routine_id) == routine_id,
        include_deleted=True,
    )
    by_pos = {r.position: r for r in rows}
    for pos, s in enumerate(steps):
        data = {
            "routine_id": routine_id,
            "habit_id": s.habit_id,
            "position": pos,
            "minutes": s.minutes,
        }
        row = by_pos.get(pos)
        if row is None:
            owned_repo.insert(ctx, RoutineStep, data, row_id=step_id(routine_id, pos))
            continue
        changed = (
            row.deleted_at is not None
            or row.habit_id != s.habit_id
            or row.minutes != s.minutes
        )
        if changed:
            owned_repo.apply(row, data)
            row.deleted_at = None
            ctx.session.add(row)
    for pos, row in by_pos.items():
        if pos >= len(steps) and row.deleted_at is None:
            row.deleted_at = ctx.now
            ctx.session.add(row)
    ctx.session.flush()


def _create_routine(ctx: Ctx, *, data: RoutineCreate) -> Routine:
    if data.id is not None:
        existing = owned_repo.get(ctx, Routine, data.id, include_deleted=True)
        if existing is not None:
            if existing.deleted_at is not None:
                raise conflict("routine_deleted", "That routine was deleted")
            return existing
    fields = data.model_dump(exclude={"id", "schedule", "steps"}, exclude_none=True)
    row = owned_repo.insert(
        ctx,
        Routine,
        {
            "icon": "🌅",
            "reminder": get_settings(ctx).default_reminder,
            **fields,
            "schedule": _dump_schedule(data.schedule) or [{"days": EVERY_DAY}],
            "status": "active",
        },
        row_id=data.id,
    )
    if data.steps:
        _write_steps(ctx, row.id, data.steps)
    _dirty(ctx, ctx.today)
    return row


def create_routine(ctx: Ctx, *, data: RoutineCreate) -> Routine:
    row = _create_routine(ctx, data=data)
    ctx.commit()
    return row


def update_routine(ctx: Ctx, *, routine_id: uuid.UUID, patch: RoutineUpdate) -> Routine:
    row = require_routine(ctx, routine_id)
    values = patch.model_dump(exclude_unset=True, exclude={"schedule"})
    if patch.schedule is not None:
        values["schedule"] = _dump_schedule(patch.schedule)
    for key in ("name", "icon", "reminder"):
        if key in values and values[key] is None:
            raise invalid("field_required", "That field can't be empty")
    owned_repo.apply(row, values)
    ctx.session.add(row)
    ctx.session.flush()
    _dirty(ctx, ctx.today)
    ctx.commit()
    return row


def upsert_routine_sync(ctx: Ctx, row_id: uuid.UUID, payload: RoutineSyncIn) -> Routine:
    values = payload.model_dump(exclude_unset=True, exclude={"schedule"})
    if payload.schedule is not None:
        values["schedule"] = _dump_schedule(payload.schedule)
    if owned_repo.get(ctx, Routine, row_id, include_deleted=True) is None:
        values.setdefault("schedule", [{"days": EVERY_DAY}])
    row, _ = owned_repo.upsert(ctx, Routine, row_id, values)
    _dirty(ctx, ctx.today)
    return row


def set_routine_steps(
    ctx: Ctx, *, routine_id: uuid.UUID, steps: list[StepIn]
) -> list[RoutineStep]:
    require_routine(ctx, routine_id)
    _write_steps(ctx, routine_id, steps)
    ctx.commit()
    return _steps(ctx, routine_id)


def upsert_step_sync(ctx: Ctx, row_id: uuid.UUID, data: dict[str, Any]) -> RoutineStep:
    existing = owned_repo.get(ctx, RoutineStep, row_id, include_deleted=True)
    routine_id = data.get("routine_id") or (existing.routine_id if existing else None)
    if routine_id is None:
        raise invalid("missing_fields", "A step needs a routine")
    require_routine(ctx, routine_id)
    if data.get("habit_id"):
        require_habit(ctx, data["habit_id"])
    data = {**data, "routine_id": routine_id}
    if existing is None and "position" in data:
        row, _ = owned_repo.upsert(
            ctx, RoutineStep, row_id, data, natural_key=("routine_id", "position")
        )
    else:
        row, _ = owned_repo.upsert(ctx, RoutineStep, row_id, data)
    return row


def archive_routine(ctx: Ctx, *, routine_id: uuid.UUID) -> Routine:
    row = require_routine(ctx, routine_id)
    row.status = "archived"
    ctx.session.add(row)
    ctx.session.flush()
    _dirty(ctx, ctx.today)
    ctx.commit()
    return row


def restore_routine(ctx: Ctx, *, routine_id: uuid.UUID) -> Routine:
    row = require_routine(ctx, routine_id)
    row.status = "active"
    ctx.session.add(row)
    ctx.session.flush()
    _dirty(ctx, ctx.today)
    ctx.commit()
    return row


def _delete_routine(ctx: Ctx, routine_id: uuid.UUID) -> None:
    """Delete a routine, its steps and its runs. Its habits and their logs
    stay (F-HAB-23)."""
    row = require_routine(ctx, routine_id)
    for s in _steps(ctx, routine_id):
        owned_repo.soft_delete(ctx, s)
    for run in owned_repo.list_rows(
        ctx, RoutineRun, col(RoutineRun.routine_id) == routine_id
    ):
        for res in _results(ctx, run.id):
            owned_repo.soft_delete(ctx, res)
        owned_repo.soft_delete(ctx, run)
        _dirty(ctx, run.day)
    profile.end_live(ctx, kind="routine", ref_id=routine_id)
    owned_repo.soft_delete(ctx, row)
    _dirty(ctx, ctx.today)


def delete_routine(ctx: Ctx, *, routine_id: uuid.UUID) -> None:
    _delete_routine(ctx, routine_id)
    ctx.commit()


# ---------------------------------------------------------------- timer


def get_timer(ctx: Ctx) -> HabitTimer | None:
    return owned_repo.find_one(ctx, HabitTimer)


def require_timer(ctx: Ctx) -> HabitTimer:
    row = get_timer(ctx)
    if row is None:
        raise not_found("timer")
    return row


def timer_elapsed(ctx: Ctx, t: HabitTimer) -> float:
    return L.step_elapsed(
        t.started_at, ctx.now, paused_at=t.paused_at, step_paused_sec=t.paused_sec
    )


def start_timer(ctx: Ctx, *, habit_id: uuid.UUID) -> HabitTimer:
    """Claim the Live bar for this habit's timer (409 ``live_session_busy``
    when something else holds it), then start or keep its timer."""
    habit = require_habit(ctx, habit_id)
    _require_manual(ctx, habit)
    profile.start_live(
        ctx,
        kind="timer",
        label=f"{habit.icon} {habit.name}",
        href=timer_href(habit.id),
        ref_id=habit.id,
    )
    row = owned_repo.find_one(ctx, HabitTimer, include_deleted=True)
    if row is not None and row.deleted_at is None and row.habit_id == habit.id:
        ctx.commit()
        return row
    target = (
        int(habit.target * 60) if habit.type == "duration" and habit.target else None
    )
    data = {
        "habit_id": habit.id,
        "day": ctx.today,
        "target_sec": target,
        "started_at": ctx.now,
        "paused_at": None,
        "paused_sec": 0,
        "bonus_sec": 0,
    }
    if row is None:
        row = owned_repo.insert(ctx, HabitTimer, data)
    else:
        owned_repo.apply(row, data)
        row.deleted_at = None
        ctx.session.add(row)
        ctx.session.flush()
    ctx.commit()
    return row


def pause_timer(ctx: Ctx) -> HabitTimer:
    row = require_timer(ctx)
    if row.paused_at is None:
        row.paused_at = ctx.now
        ctx.session.add(row)
        ctx.session.flush()
        profile.pause_live(ctx)
    ctx.commit()
    return row


def resume_timer(ctx: Ctx) -> HabitTimer:
    row = require_timer(ctx)
    if row.paused_at is not None:
        row.paused_sec += int((ctx.now - row.paused_at).total_seconds())
        row.paused_at = None
        ctx.session.add(row)
        ctx.session.flush()
        profile.resume_live(ctx)
    ctx.commit()
    return row


def extend_timer(ctx: Ctx, *, sec: int) -> HabitTimer:
    row = require_timer(ctx)
    row.target_sec = (row.target_sec or 0) + sec
    ctx.session.add(row)
    ctx.session.flush()
    ctx.commit()
    return row


def _discard_timer(ctx: Ctx, row: HabitTimer) -> None:
    owned_repo.soft_delete(ctx, row)
    profile.end_live(ctx, kind="timer", ref_id=row.habit_id)


def finish_timer(ctx: Ctx, *, minutes: float | None = None) -> HabitLog:
    """Log the timed minutes (done when they reach the target, else partial)
    on the day the timer started, then release the timer."""
    row = require_timer(ctx)
    measured = timer_elapsed(ctx, row) / 60 if minutes is None else minutes
    habit = require_habit(ctx, row.habit_id)
    log = _log(
        ctx,
        habit=habit,
        day=row.day,
        value=max(1, L.js_round(measured)),
        source="timer",
    )
    _discard_timer(ctx, row)
    ctx.commit()
    return log


def discard_timer(ctx: Ctx) -> None:
    row = get_timer(ctx)
    if row is not None:
        _discard_timer(ctx, row)
    ctx.commit()


# ---------------------------------------------------------------- routine runs


def _results(ctx: Ctx, run_id: uuid.UUID) -> list[RoutineStepResult]:
    return owned_repo.list_rows(
        ctx,
        RoutineStepResult,
        col(RoutineStepResult.run_id) == run_id,
        order_by=(col(RoutineStepResult.position),),
    )


def results_for(ctx: Ctx, run_id: uuid.UUID) -> list[RoutineStepResult]:
    return _results(ctx, run_id)


def _set_result(
    ctx: Ctx, run: RoutineRun, position: int, habit_id: str, status: str, sec: int
) -> None:
    data = {
        "run_id": run.id,
        "position": position,
        "habit_id": uuid.UUID(habit_id),
        "status": status,
        "actual_sec": sec,
    }
    owned_repo.upsert(
        ctx,
        RoutineStepResult,
        derived_id("run-step", run.id, str(position)),
        data,
        natural_key=("run_id", "position"),
    )


def _truncate_results(ctx: Ctx, run: RoutineRun, keep: int) -> None:
    for res in _results(ctx, run.id):
        if res.position >= keep:
            owned_repo.soft_delete(ctx, res)


def _abandon(ctx: Ctx, run: RoutineRun) -> None:
    """Close an unfinished run: unreached steps get ``not_reached`` rows."""
    have = {r.position for r in _results(ctx, run.id)}
    for pos, step in enumerate(run.steps):
        if pos not in have:
            _set_result(ctx, run, pos, str(step["habit_id"]), "not_reached", 0)
    run.state = "abandoned"
    run.paused_at = None
    ctx.session.add(run)
    ctx.session.flush()
    _dirty(ctx, run.day)


def settle_stale_runs(ctx: Ctx, *, keep: uuid.UUID | None = None) -> None:
    """Abandon every in-progress run except ``keep``."""
    for run in owned_repo.list_rows(
        ctx, RoutineRun, col(RoutineRun.state) == "in_progress"
    ):
        if run.id != keep:
            _abandon(ctx, run)


def _active_run(ctx: Ctx, routine_id: uuid.UUID) -> RoutineRun | None:
    return owned_repo.find_one(
        ctx,
        RoutineRun,
        col(RoutineRun.routine_id) == routine_id,
        col(RoutineRun.day) == ctx.today,
        col(RoutineRun.state) == "in_progress",
    )


def active_run(ctx: Ctx, routine_id: uuid.UUID) -> RoutineRun | None:
    return _active_run(ctx, routine_id)


def _live_label(ctx: Ctx, routine: Routine, steps: list[dict[str, Any]], i: int) -> str:
    name = ""
    if i < len(steps):
        h = owned_repo.get(ctx, Habit, uuid.UUID(str(steps[i]["habit_id"])))
        name = f" · {h.name}" if h else ""
    shown = min(i + 1, len(steps))
    return f"{routine.icon} {routine.name}{name} ({shown}/{len(steps)})"


def _start_routine(
    ctx: Ctx, *, routine_id: uuid.UUID, run_id: uuid.UUID | None = None
) -> RoutineRun:
    routine = require_routine(ctx, routine_id)
    run = _active_run(ctx, routine_id)
    if run is None and run_id is not None:
        replay = owned_repo.get(ctx, RoutineRun, run_id)
        if replay is not None and replay.routine_id == routine_id:
            return replay  # a replayed start of a run that already moved on
    if run is not None:
        steps = list(run.steps)
    else:
        habits = {
            h.id: h
            for h in owned_repo.list_rows(ctx, Habit, col(Habit.status) != "archived")
        }
        steps = [
            {"habit_id": str(s.habit_id), "minutes": s.minutes}
            for s in _steps(ctx, routine_id)
            if s.habit_id in habits
        ]
    profile.start_live(
        ctx,
        kind="routine",
        label=_live_label(ctx, routine, steps, run.current if run else 0),
        href=player_href(routine_id),
        ref_id=routine_id,
    )
    if run is not None:
        return run
    settle_stale_runs(ctx)
    run = owned_repo.insert(
        ctx,
        RoutineRun,
        {
            "routine_id": routine_id,
            "day": ctx.today,
            "started_at": ctx.now,
            "steps": steps,
            "current": 0,
            "step_started_at": ctx.now,
            "step_paused_sec": 0,
            "step_bonus_sec": 0,
            "state": "in_progress",
        },
        row_id=run_id,
    )
    _dirty(ctx, ctx.today)
    if not steps:  # nothing to play: an empty routine completes at once
        _finish_run(ctx, run)
    return run


def start_routine(
    ctx: Ctx, *, routine_id: uuid.UUID, run_id: uuid.UUID | None = None
) -> RoutineRun:
    run = _start_routine(ctx, routine_id=routine_id, run_id=run_id)
    ctx.commit()
    return run


def _require_running(ctx: Ctx, run_id: uuid.UUID) -> RoutineRun:
    run = owned_repo.require(ctx, RoutineRun, run_id, what="routine_run")
    if run.state == "in_progress" and run.day < ctx.today:
        _abandon(ctx, run)
        ctx.commit()
    if run.state != "in_progress":
        raise conflict("run_not_in_progress", "This run has already ended")
    return run


def _finish_run(ctx: Ctx, run: RoutineRun) -> None:
    run.state = "completed"
    run.ended_at = ctx.now
    run.paused_at = None
    ctx.session.add(run)
    ctx.session.flush()
    profile.end_live(ctx, kind="routine", ref_id=run.routine_id)


def _reset_step_clock(ctx: Ctx, run: RoutineRun) -> None:
    run.step_started_at = ctx.now
    run.step_paused_sec = 0
    run.step_bonus_sec = 0
    if run.paused_at is not None:
        run.paused_at = None
        profile.resume_live(ctx)


def _advance(
    ctx: Ctx, run: RoutineRun, status: Literal["done", "skipped"], *, log: bool = True
) -> RoutineRun:
    if run.current >= len(run.steps):
        return run
    step = run.steps[run.current]
    habit_id = str(step["habit_id"])
    actual = 0
    if status == "done" and log:
        actual = L.js_round(
            L.step_elapsed(
                run.step_started_at,
                ctx.now,
                paused_at=run.paused_at,
                step_paused_sec=run.step_paused_sec,
            )
        )
    _truncate_results(ctx, run, run.current)
    _set_result(ctx, run, run.current, habit_id, status, actual)
    habit = owned_repo.get(ctx, Habit, uuid.UUID(habit_id))
    if habit is not None and log:
        if status == "done":
            if habit.type == "duration":
                _log(
                    ctx,
                    habit=habit,
                    day=run.day,
                    value=max(1, L.js_round(actual / 60)),
                    source="routine",
                )
            elif habit.type == "count":
                _log(
                    ctx,
                    habit=habit,
                    day=run.day,
                    value=habit.step or 1,
                    add=True,
                    source="routine",
                )
            else:
                _log(ctx, habit=habit, day=run.day, status="done", source="routine")
        elif _find_log(ctx, habit.id, run.day) is None:
            _log(ctx, habit=habit, day=run.day, status="skipped", source="routine")
    run.current += 1
    _reset_step_clock(ctx, run)
    ctx.session.add(run)
    ctx.session.flush()
    if run.current >= len(run.steps):
        _finish_run(ctx, run)
    else:
        _relabel_run(ctx, run)
    _dirty(ctx, run.day)
    return run


def _relabel_run(ctx: Ctx, run: RoutineRun) -> None:
    routine = owned_repo.get(ctx, Routine, run.routine_id)
    if routine is not None:
        profile.update_live_label(
            ctx,
            kind="routine",
            ref_id=run.routine_id,
            label=_live_label(ctx, routine, list(run.steps), run.current),
        )


def step_done(ctx: Ctx, *, run_id: uuid.UUID) -> RoutineRun:
    run = _advance(ctx, _require_running(ctx, run_id), "done")
    ctx.commit()
    return run


def step_skip(ctx: Ctx, *, run_id: uuid.UUID) -> RoutineRun:
    run = _advance(ctx, _require_running(ctx, run_id), "skipped")
    ctx.commit()
    return run


def step_continue(ctx: Ctx, *, run_id: uuid.UUID) -> RoutineRun:
    """Move past a step whose habit is already logged today: recorded as done
    with no time and no new log."""
    run = _advance(ctx, _require_running(ctx, run_id), "done", log=False)
    ctx.commit()
    return run


def step_back(ctx: Ctx, *, run_id: uuid.UUID) -> RoutineRun:
    """Return to the previous step; its result is dropped (the habit log it
    made stays, as in the prototype)."""
    run = _require_running(ctx, run_id)
    if run.current > 0:
        run.current -= 1
        _truncate_results(ctx, run, run.current)
        _reset_step_clock(ctx, run)
        ctx.session.add(run)
        ctx.session.flush()
        _relabel_run(ctx, run)
    ctx.commit()
    return run


def step_add_minute(ctx: Ctx, *, run_id: uuid.UUID) -> RoutineRun:
    run = _require_running(ctx, run_id)
    run.step_bonus_sec += 60
    ctx.session.add(run)
    ctx.session.flush()
    ctx.commit()
    return run


def toggle_run_pause(ctx: Ctx, *, run_id: uuid.UUID) -> RoutineRun:
    run = _require_running(ctx, run_id)
    if run.paused_at is not None:
        run.step_paused_sec += int((ctx.now - run.paused_at).total_seconds())
        run.paused_at = None
        profile.resume_live(ctx)
    else:
        run.paused_at = ctx.now
        profile.pause_live(ctx)
    ctx.session.add(run)
    ctx.session.flush()
    ctx.commit()
    return run


def abandon_run(ctx: Ctx, *, run_id: uuid.UUID) -> RoutineRun:
    """Start over: today's run ends unfinished, so the next start begins at
    step one. Habits its steps already logged stay logged (they were done)."""
    run = _require_running(ctx, run_id)
    _abandon(ctx, run)
    profile.end_live(ctx, kind="routine", ref_id=run.routine_id)
    ctx.commit()
    return run


def exit_routine(ctx: Ctx, *, run_id: uuid.UUID) -> RoutineRun:
    run = owned_repo.require(ctx, RoutineRun, run_id, what="routine_run")
    profile.end_live(ctx, kind="routine", ref_id=run.routine_id)
    ctx.commit()
    return run


# ---------------------------------------------------------------- lookups


def _rank(name: str, q: str) -> int | None:
    n = name.lower()
    if n == q:
        return 0
    if n.startswith(q):
        return 1
    if q in n:
        return 2
    first = n.split(" ")[0]
    if first and first in q:
        return 3
    return None


def find_habits(ctx: Ctx, query: str, *, limit: int = 5) -> list[Habit]:
    q = query.lower().strip()
    if not q:
        return []
    ranked: list[tuple[int, int, Habit]] = []
    for h in owned_repo.list_rows(ctx, Habit, col(Habit.status) != "archived"):
        r = _rank(h.name, q)
        if r is not None:
            ranked.append((r, h.sort_order, h))
    ranked.sort(key=lambda x: (x[0], x[1]))
    return [h for _, _, h in ranked[:limit]]


def find_routines(ctx: Ctx, query: str, *, limit: int = 5) -> list[Routine]:
    q = query.lower().strip()
    if not q:
        return []
    ranked: list[tuple[int, str, Routine]] = []
    for r in owned_repo.list_rows(ctx, Routine, col(Routine.status) == "active"):
        k = _rank(r.name, q)
        if k is not None:
            ranked.append((k, r.name, r))
    ranked.sort(key=lambda x: (x[0], x[1]))
    return [r for _, _, r in ranked[:limit]]


def auto_check_workout_habits(
    ctx: Ctx, *, day: date, workout_id: uuid.UUID
) -> list[HabitLog]:
    """Tick every non-archived habit linked to workouts that is not already
    done on ``day`` (``autoCheckWorkoutHabits``). A habit with a screen-time
    rule is left alone: only screen time completes it. Flushes only."""
    out: list[HabitLog] = []
    for h in owned_repo.list_rows(
        ctx,
        Habit,
        col(Habit.link_workout).is_(True),
        col(Habit.status) != "archived",
        col(Habit.rule_kind).is_(None),
    ):
        cur = _find_log(ctx, h.id, day)
        if cur is not None and cur.status == "done":
            continue
        out.append(
            _check(
                ctx,
                habit=h,
                day=day,
                source="workout",
                log_id=derived_id("workout-habit", workout_id, str(h.id)),
            )
        )
    return out
