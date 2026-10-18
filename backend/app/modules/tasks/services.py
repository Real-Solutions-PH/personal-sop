"""Use cases of the tasks module: one function per screen action, each ending
with ``ctx.commit()``. The mutations themselves live in ``ops`` (shared with
sync and the cross-module contract)."""

import uuid
from collections import OrderedDict
from datetime import date, datetime
from typing import Any

from app.modules.tasks import logic, ops, repo
from app.modules.tasks.models import Task, TaskList, TaskNotifState, TaskSettings
from app.modules.tasks.parse import parse_task, valid_day
from app.modules.tasks.schema import (
    CaptureResult,
    CompletedDay,
    CompletedPublic,
    CompleteResult,
    DayCountPublic,
    ListCountPublic,
    ListCreate,
    ListsPublic,
    ListWithCounts,
    OverduePublic,
    OverdueTask,
    ParsePublic,
    ShareMetric,
    SharePublic,
    StatsPair,
    StatsPublic,
    TaskCreate,
    TaskDetail,
    TaskPublic,
    TasksPublic,
    TodayPublic,
    UpcomingPublic,
)
from app.shared.context import Ctx

RANGE_LABEL = {7: "this week", 30: "this month", 90: "last 90 days"}


def task_public(t: Task) -> TaskPublic:
    return TaskPublic.model_validate(t)


def _publics(rows: list[Task]) -> list[TaskPublic]:
    return [task_public(t) for t in rows]


def _new(inp: TaskCreate) -> ops.NewTask:
    return ops.NewTask(
        title=inp.title,
        list_id=inp.list_id,
        due_date=inp.due_date,
        due_time=inp.due_time,
        remind=inp.remind,
        remind_at=inp.remind_at,
        recurrence=inp.recurrence.model_dump() if inp.recurrence else None,
        notes=inp.notes,
        starred=inp.starred,
        source=inp.source,
        parse_state=inp.parse_state,
        task_id=inp.id,
    )


# ---------------------------------------------------------------- reads


def get_task(ctx: Ctx, *, task_id: uuid.UUID) -> TaskDetail:
    t = repo.live_task(ctx, task_id)
    lst = repo.live_list(ctx, t.list_id) if t.list_id else None
    return TaskDetail(
        **task_public(t).model_dump(),
        repeat_text=logic.fmt_repeat(t.recurrence),
        list_name=lst.name if lst else "Inbox",
    )


def find_tasks(ctx: Ctx, *, f: repo.TaskFilter, skip: int, limit: int) -> TasksPublic:
    rows, count = repo.find_tasks(ctx, f, skip=skip, limit=limit)
    return TasksPublic(data=_publics(rows), count=count)


def completed(ctx: Ctx, *, days: int, skip: int, limit: int) -> CompletedPublic:
    first = logic.add_days(ctx.today, -(days - 1))
    rows, count = repo.completed_since(ctx, first, skip=skip, limit=limit)
    groups: OrderedDict[date, list[TaskPublic]] = OrderedDict()
    for t in rows:
        if t.completed_at is None:
            continue
        groups.setdefault(ctx.clock.day_of(t.completed_at), []).append(task_public(t))
    return CompletedPublic(
        data=[CompletedDay(day=d, tasks=ts) for d, ts in groups.items()], count=count
    )


def recently_deleted(ctx: Ctx, *, skip: int, limit: int) -> TasksPublic:
    rows, count = repo.recently_deleted(ctx, skip=skip, limit=limit)
    return TasksPublic(data=_publics(rows), count=count)


def overdue(ctx: Ctx) -> OverduePublic:
    found = repo.overdue_open(ctx, ctx.today)
    rows = logic.sort_by_due(repo.task_view(t) for t in found)
    by_id = {str(t.id): t for t in found}
    data = [
        OverdueTask(
            **task_public(by_id[v.id]).model_dump(),
            days_late=logic.diff_days(v.due_date or ctx.today, ctx.today),
        )
        for v in rows
    ]
    return OverduePublic(data=data, count=len(data))


def today(ctx: Ctx) -> TodayPublic:
    loaded = repo.load_state(ctx)
    d = logic.today_data(loaded.state, ctx.now, ctx.clock)
    p = logic.today_progress(loaded.state, ctx.now, ctx.clock)

    def pub(views: list[logic.TaskView]) -> list[TaskPublic]:
        return [task_public(loaded.rows[v.id]) for v in views]

    due_now = [
        loaded.rows[v.id].id
        for v in loaded.state.tasks
        if logic.is_due_now(v, ctx.now, ctx.clock)
    ]
    return TodayPublic(
        day=ctx.today,
        overdue=pub(d.overdue),
        due=pub(d.due),
        done_today=pub(d.done_today),
        done_due_today=pub(d.done_due_today),
        upcoming=[UpcomingPublic(day=u.day, tasks=pub(u.tasks)) for u in d.upcoming],
        later=pub(d.later),
        inbox=pub(d.inbox),
        starred=pub(d.starred),
        shopping_open=d.shopping_open,
        next_reminder=(
            task_public(loaded.rows[d.next_reminder.id]) if d.next_reminder else None
        ),
        ever_had_tasks=d.ever_had_tasks,
        due_now=due_now,
        progress_due=p.due,
        progress_done=p.done,
    )


def _stats_public(s: logic.TaskStats, loaded: repo.Loaded) -> StatsPublic:
    return StatsPublic(
        first=s.first,
        last=s.last,
        done=s.done,
        on_time=s.on_time,
        late=s.late,
        with_due=s.with_due,
        on_time_rate=s.on_time_rate,
        streak=s.streak,
        best_streak=s.best_streak,
        clear_days=s.clear_days,
        due_days=s.due_days,
        overdue_now=s.overdue_now,
        reschedules=s.reschedules,
        avg_reschedules=s.avg_reschedules,
        avg_lateness=s.avg_lateness,
        follow_through=s.follow_through,
        capture_share=s.capture_share,
        created=s.created,
        per_day=[DayCountPublic(day=p.day, done=p.done) for p in s.per_day],
        by_list=[
            ListCountPublic(
                id=uuid.UUID(x.id) if x.id else None, name=x.name, done=x.done
            )
            for x in s.by_list
        ],
        top_pushed=[task_public(loaded.rows[t.id]) for t in s.top_pushed],
    )


def stats_for(
    ctx: Ctx, loaded: repo.Loaded, days: int, offset: int = 0
) -> logic.TaskStats:
    first, last = logic.stats_window(ctx.today, days, offset)
    return logic.compute_stats(loaded.state, first, last, ctx.today, ctx.clock)


def stats(ctx: Ctx, *, days: int) -> StatsPair:
    loaded = repo.load_state(ctx)
    return StatsPair(
        days=days,
        current=_stats_public(stats_for(ctx, loaded, days), loaded),
        previous=_stats_public(stats_for(ctx, loaded, days, days), loaded),
    )


def share(ctx: Ctx, *, days: int) -> SharePublic:
    """The share-card data (``task-share.tsx``): its five metrics with the
    screen's default toggles, and the caption for those defaults."""
    loaded = repo.load_state(ctx)
    cur = stats_for(ctx, loaded, days)
    prev = stats_for(ctx, loaded, days, days)
    label = RANGE_LABEL.get(days, f"last {days} days")
    pct = (
        "—"
        if cur.on_time_rate is None
        else f"{logic.js_round(cur.on_time_rate * 100)}%"
    )
    metrics = [
        ShareMetric(key="done", label="Done", value=str(cur.done), default_on=True),
        ShareMetric(key="onTime", label="On time", value=pct, default_on=True),
        ShareMetric(
            key="streak", label="Day streak", value=str(cur.streak), default_on=True
        ),
        ShareMetric(
            key="clear",
            label="Clear days",
            value=f"{cur.clear_days}/{cur.due_days}",
            default_on=False,
        ),
        ShareMetric(
            key="followThrough",
            label="Follow-through",
            value=logic.js_to_fixed(cur.follow_through, 1),
            default_on=False,
        ),
    ]
    shown = [m for m in metrics if m.default_on]
    caption = (
        f"Tasks {label}: "
        + " · ".join(f"{m.value} {m.label.lower()}" for m in shown)
        + " · Personal SOP"
    )
    return SharePublic(
        days=days,
        range_label=label,
        metrics=metrics,
        caption=caption,
        current=_stats_public(cur, loaded),
        previous=_stats_public(prev, loaded),
    )


def parse(ctx: Ctx, *, text: str) -> ParsePublic:
    p = parse_task(text, ctx.today.isoformat())
    return ParsePublic(
        title=p.title,
        due_date=valid_day(p.due_date),
        due_time=p.due_time,
        recurrence=p.recurrence,  # type: ignore[arg-type]
        matched=p.matched,
    )


def lists(ctx: Ctx, *, include_archived: bool) -> ListsPublic:
    rows = repo.lists(ctx, include_archived=include_archived)
    counts = repo.open_counts(ctx)
    data = [
        ListWithCounts.model_validate(lst, from_attributes=True).model_copy(
            update={"open_count": counts.get(lst.id, 0)}
        )
        for lst in rows
    ]
    return ListsPublic(data=data, count=len(data))


def get_list(ctx: Ctx, *, list_id: uuid.UUID) -> TaskList:
    return repo.live_list(ctx, list_id)


def get_settings(ctx: Ctx) -> TaskSettings:
    return repo.settings_or_default(ctx)


def get_notif(ctx: Ctx) -> TaskNotifState:
    return repo.notif_or_default(ctx)


# ---------------------------------------------------------------- create


def create_task(ctx: Ctx, *, inp: TaskCreate) -> Task:
    row = ops.create_tasks(ctx, [_new(inp)])[0]
    ctx.commit()
    return row


def create_tasks(ctx: Ctx, *, inps: list[TaskCreate]) -> list[Task]:
    rows = ops.create_tasks(ctx, [_new(i) for i in inps])
    ctx.commit()
    return rows


def capture(ctx: Ctx, *, text: str, source: str) -> CaptureResult:
    rows, follow = ops.capture(ctx, text, source)
    ctx.commit()
    return CaptureResult(tasks=_publics(rows), follow_up=follow)


def remove_tasks(ctx: Ctx, *, task_ids: list[uuid.UUID]) -> None:
    ops.remove_tasks(ctx, task_ids)
    ctx.commit()


# ---------------------------------------------------------------- complete


def complete(
    ctx: Ctx, *, task_id: uuid.UUID, completed_at: datetime | None = None
) -> CompleteResult:
    t, nxt = ops.complete(ctx, repo.live_task(ctx, task_id), completed_at)
    ctx.commit()
    return CompleteResult(task=task_public(t), next=task_public(nxt) if nxt else None)


def uncomplete(ctx: Ctx, *, task_id: uuid.UUID) -> Task:
    t = ops.uncomplete(ctx, repo.live_task(ctx, task_id))
    ctx.commit()
    return t


def toggle(ctx: Ctx, *, task_id: uuid.UUID) -> CompleteResult:
    t = repo.live_task(ctx, task_id)
    if t.status == "done":
        ops.uncomplete(ctx, t)
        nxt = None
    else:
        t, nxt = ops.complete(ctx, t)
    ctx.commit()
    return CompleteResult(task=task_public(t), next=task_public(nxt) if nxt else None)


# ---------------------------------------------------------------- edit


def update(ctx: Ctx, *, task_id: uuid.UUID, patch: dict[str, Any]) -> Task:
    t = ops.update(ctx, repo.live_task(ctx, task_id), patch)
    ctx.commit()
    return t


def set_due(
    ctx: Ctx,
    *,
    task_id: uuid.UUID,
    due_date: date | None,
    due_time: str | None = ops.UNSET,
    remind_at: datetime | None = ops.UNSET,
) -> Task:
    t = ops.set_due(ctx, repo.live_task(ctx, task_id), due_date, due_time, remind_at)
    ctx.commit()
    return t


def reschedule_by(ctx: Ctx, *, task_id: uuid.UUID, days: int) -> Task:
    t = ops.reschedule_by(ctx, repo.live_task(ctx, task_id), days)
    ctx.commit()
    return t


def move_overdue_to_today(ctx: Ctx) -> int:
    n = ops.move_overdue_to_today(ctx)
    ctx.commit()
    return n


def snooze(ctx: Ctx, *, task_id: uuid.UUID, minutes: int) -> Task:
    t = ops.snooze(ctx, repo.live_task(ctx, task_id), minutes)
    ctx.commit()
    return t


def delete(ctx: Ctx, *, task_id: uuid.UUID) -> Task:
    t = ops.soft_delete(ctx, repo.live_task(ctx, task_id))
    ctx.commit()
    return t


def restore(ctx: Ctx, *, task_id: uuid.UUID) -> Task:
    t = ops.restore(ctx, repo.soft_deleted_task(ctx, task_id))
    ctx.commit()
    return t


def duplicate(ctx: Ctx, *, task_id: uuid.UUID, new_id: uuid.UUID | None) -> Task:
    t = ops.duplicate(ctx, repo.live_task(ctx, task_id), new_id)
    ctx.commit()
    return t


def move(ctx: Ctx, *, task_id: uuid.UUID, step: int, ids: list[uuid.UUID]) -> None:
    ops.move(ctx, task_id, step, ids)
    ctx.commit()


def clear_checked(ctx: Ctx, *, list_id: uuid.UUID) -> list[uuid.UUID]:
    ids = ops.clear_checked(ctx, list_id)
    ctx.commit()
    return ids


def unclear(ctx: Ctx, *, task_ids: list[uuid.UUID]) -> list[uuid.UUID]:
    ids = ops.unclear(ctx, task_ids)
    ctx.commit()
    return ids


# ---------------------------------------------------------------- lists


def create_list(ctx: Ctx, *, inp: ListCreate) -> TaskList:
    row = ops.create_list(ctx, inp.model_dump(exclude={"id"}), inp.id)
    ctx.commit()
    return row


def ensure_default_lists(ctx: Ctx) -> ListsPublic:
    ops.ensure_default_lists(ctx)
    ctx.commit()
    return lists(ctx, include_archived=True)


def update_list(ctx: Ctx, *, list_id: uuid.UUID, patch: dict[str, Any]) -> TaskList:
    row = ops.update_list(ctx, repo.live_list(ctx, list_id), patch)
    ctx.commit()
    return row


def set_list_archived(ctx: Ctx, *, list_id: uuid.UUID, archived: bool) -> TaskList:
    row = ops.set_list_archived(ctx, repo.live_list(ctx, list_id), archived)
    ctx.commit()
    return row


def delete_list(ctx: Ctx, *, list_id: uuid.UUID, mode: str) -> int:
    n = ops.delete_list(ctx, repo.live_list(ctx, list_id), mode)
    ctx.commit()
    return n


def move_list(ctx: Ctx, *, list_id: uuid.UUID, step: int) -> ListsPublic:
    ops.move_list(ctx, repo.live_list(ctx, list_id), step)
    ctx.commit()
    return lists(ctx, include_archived=True)


# ---------------------------------------------------------------- settings


def update_settings(ctx: Ctx, *, patch: dict[str, Any]) -> TaskSettings:
    row = ops.update_settings(ctx, patch)
    ctx.commit()
    return row


def update_notif(ctx: Ctx, *, patch: dict[str, Any]) -> TaskNotifState:
    row = ops.update_notif(ctx, patch)
    ctx.commit()
    return row
