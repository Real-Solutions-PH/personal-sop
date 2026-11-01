"""Focus use cases (ADR-0025): synced writes from the phone, timer actions
for Fern and the REST API, and the reads the screens and stats need.

The phone writes sessions and segments as plain rows through ``/sync``
(it runs the timer itself, offline too). The server checks each write,
then re-derives the session's ``day``, ``focus_sec`` and ``sets_completed``
from its segments. Actions here (start, pause, switch, stop…) load the
session into :mod:`logic`, apply the same pure function the phone applies,
and save what changed. Reads never write: a running session is read
through :func:`logic.advance` in memory.
"""

import uuid
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from typing import Any, Literal, cast

from sqlmodel import col, or_

from app.modules.focus import logic as L
from app.modules.focus.models import FocusSegment, FocusSession, FocusSettings
from app.modules.focus.schema import (
    Block,
    ItemRef,
    ItemSession,
    ItemTime,
    ItemTimeOut,
    PhaseOut,
    SegmentPublic,
    SegmentSyncIn,
    SessionDetail,
    SessionPublic,
    SessionSyncIn,
    SettingsIn,
    StartIn,
    TodayOut,
)
from app.shared import owned_repo
from app.shared.context import Ctx
from app.shared.domain import conflict, invalid, not_found
from app.shared.ids import derived_id

# ---------------------------------------------------------------- settings


def settings_id(ctx: Ctx) -> uuid.UUID:
    return derived_id("focus-settings", ctx.user_id, "settings")


def get_settings(ctx: Ctx) -> FocusSettings:
    """The caller's settings; an unsaved default row when never changed."""
    row = owned_repo.find_one(ctx, FocusSettings)
    return row or FocusSettings(id=settings_id(ctx), **ctx.owned())


def update_settings(ctx: Ctx, *, patch: SettingsIn) -> FocusSettings:
    data = patch.model_dump(exclude_unset=True, exclude_none=True)
    row = owned_repo.find_one(ctx, FocusSettings, include_deleted=True)
    if row is None:
        row = owned_repo.insert(ctx, FocusSettings, data, row_id=settings_id(ctx))
    else:
        owned_repo.apply(row, data)
        row.deleted_at = None
        ctx.session.add(row)
        ctx.session.flush()
    ctx.commit()
    return row


# ---------------------------------------------------------------- mapping


def _item(
    kind: str | None, item_id: uuid.UUID | None, title: str | None
) -> L.Item | None:
    if kind is None or item_id is None:
        return None
    return L.Item(cast(Literal["task", "habit"], kind), item_id, title)


def to_sess(row: FocusSession) -> L.Sess:
    return L.Sess(
        id=row.id,
        mode=cast(L.Mode, row.mode),
        started_at=row.started_at,
        focus_min=row.focus_min,
        short_break_min=row.short_break_min,
        long_break_min=row.long_break_min,
        sets_before_long=row.sets_before_long,
        auto_start_breaks=row.auto_start_breaks,
        auto_start_focus=row.auto_start_focus,
        ended_at=row.ended_at,
        end_reason=cast(Any, row.end_reason),
        item=_item(row.item_kind, row.item_id, row.item_title),
    )


def to_seg(row: FocusSegment) -> L.Seg:
    return L.Seg(
        id=row.id,
        kind=cast(L.Kind, row.kind),
        started_at=row.started_at,
        ended_at=row.ended_at,
        set_index=row.set_index,
        planned_sec=row.planned_sec,
        item=_item(row.item_kind, row.item_id, row.item_title),
    )


def _item_fields(item: L.Item | None) -> dict[str, Any]:
    return {
        "item_kind": item.kind if item else None,
        "item_id": item.id if item else None,
        "item_title": item.title if item else None,
    }


def _seg_fields(s: L.Seg, session_id: uuid.UUID) -> dict[str, Any]:
    return {
        "session_id": session_id,
        "kind": s.kind,
        "started_at": s.started_at,
        "ended_at": s.ended_at,
        "set_index": s.set_index,
        "planned_sec": s.planned_sec,
        **_item_fields(s.item),
    }


def _sess_fields(s: L.Sess) -> dict[str, Any]:
    return {
        "mode": s.mode,
        "focus_min": s.focus_min,
        "short_break_min": s.short_break_min,
        "long_break_min": s.long_break_min,
        "sets_before_long": s.sets_before_long,
        "auto_start_breaks": s.auto_start_breaks,
        "auto_start_focus": s.auto_start_focus,
        "started_at": s.started_at,
        "ended_at": s.ended_at,
        "end_reason": s.end_reason,
        **_item_fields(s.item),
    }


# ---------------------------------------------------------------- loading


def require_session(ctx: Ctx, session_id: uuid.UUID) -> FocusSession:
    return owned_repo.require(ctx, FocusSession, session_id, what="Focus session")


def segment_rows(ctx: Ctx, session_ids: list[uuid.UUID]) -> list[FocusSegment]:
    if not session_ids:
        return []
    return owned_repo.list_rows(
        ctx,
        FocusSegment,
        col(FocusSegment.session_id).in_(session_ids),
        order_by=[col(FocusSegment.started_at)],
    )


def timeline_of(row: FocusSession, segs: list[FocusSegment]) -> L.Timeline:
    return L.Timeline(to_sess(row), L.ordered(to_seg(s) for s in segs))


def timelines(
    ctx: Ctx, lo: datetime, hi: datetime
) -> list[tuple[FocusSession, L.Timeline]]:
    """Sessions with any time inside ``[lo, hi)``: begun before ``hi`` and
    not ended before ``lo`` (a running one is open-ended)."""
    rows = owned_repo.list_rows(
        ctx,
        FocusSession,
        col(FocusSession.started_at) < hi,
        or_(col(FocusSession.ended_at).is_(None), col(FocusSession.ended_at) >= lo),
        order_by=[col(FocusSession.started_at)],
    )
    by: dict[uuid.UUID, list[FocusSegment]] = {r.id: [] for r in rows}
    for s in segment_rows(ctx, list(by)):
        by[s.session_id].append(s)
    return [(r, L.advance(timeline_of(r, by[r.id]), ctx.now)) for r in rows]


def current_row(ctx: Ctx) -> FocusSession | None:
    """The newest session that has not ended."""
    rows = owned_repo.list_rows(
        ctx,
        FocusSession,
        col(FocusSession.ended_at).is_(None),
        order_by=[col(FocusSession.started_at).desc()],
        limit=1,
    )
    return rows[0] if rows else None


def load(ctx: Ctx, row: FocusSession) -> L.Timeline:
    return L.advance(timeline_of(row, segment_rows(ctx, [row.id])), ctx.now)


# ---------------------------------------------------------------- derived


def recompute(ctx: Ctx, row: FocusSession) -> FocusSession:
    """Re-derive the session's day and totals from its segments."""
    tl = timeline_of(row, segment_rows(ctx, [row.id]))
    row.day = ctx.clock.day_of(row.started_at)
    row.focus_sec = L.focus_sec(tl, ctx.now)
    row.sets_completed = L.sets_completed(tl, ctx.now)
    ctx.session.add(row)
    ctx.session.flush()
    return row


def _save(ctx: Ctx, row: FocusSession | None, tl: L.Timeline) -> FocusSession:
    """Write a timeline back: the session's fields and every segment that
    is new or changed."""
    if row is None:
        row = owned_repo.insert(
            ctx, FocusSession, _sess_fields(tl.sess), row_id=tl.sess.id
        )
    else:
        owned_repo.apply(row, _sess_fields(tl.sess))
        ctx.session.add(row)
    existing = {s.id: s for s in segment_rows(ctx, [row.id])}
    for s in tl.segs:
        data = _seg_fields(s, row.id)
        old = existing.get(s.id)
        if old is None:
            owned_repo.upsert(ctx, FocusSegment, s.id, data)
        elif to_seg(old) != s:
            owned_repo.apply(old, data)
            ctx.session.add(old)
    ctx.session.flush()
    return recompute(ctx, row)


# ---------------------------------------------------------------- sync writes


def _check_item(data: dict[str, Any], existing: Any) -> None:
    kind = (
        data["item_kind"]
        if "item_kind" in data
        else getattr(existing, "item_kind", None)
    )
    iid = data["item_id"] if "item_id" in data else getattr(existing, "item_id", None)
    if (kind is None) != (iid is None):
        raise invalid("focus_item_invalid", "An item needs both a kind and an id")


def _check_range(data: dict[str, Any], existing: Any) -> None:
    start = data.get("started_at") or getattr(existing, "started_at", None)
    end = (
        data["ended_at"] if "ended_at" in data else getattr(existing, "ended_at", None)
    )
    if start is not None and end is not None and end < start:
        raise invalid("focus_range_invalid", "A span can't end before it starts")


# A phone's clock may run a little ahead of the server's.
CLOCK_SKEW = timedelta(minutes=5)


def _check_logged(ctx: Ctx, data: dict[str, Any], existing: Any) -> None:
    """A session logged afterwards is over and in the past: it has an end,
    and neither end reaches past now."""
    source = data.get("source") or getattr(existing, "source", "timer")
    if source != "manual":
        return
    start = data.get("started_at") or getattr(existing, "started_at", None)
    end = (
        data["ended_at"] if "ended_at" in data else getattr(existing, "ended_at", None)
    )
    if end is None:
        raise invalid("focus_logged_open", "A logged session needs an end time")
    limit = ctx.now + CLOCK_SKEW
    if end > limit or (start is not None and start > limit):
        raise invalid("focus_logged_future", "A logged session can't be in the future")


def upsert_session_sync(
    ctx: Ctx, row_id: uuid.UUID, payload: SessionSyncIn
) -> FocusSession:
    data = payload.model_dump(exclude_unset=True)
    existing = owned_repo.get(ctx, FocusSession, row_id, include_deleted=True)
    _check_item(data, existing)
    _check_range(data, existing)
    _check_logged(ctx, data, existing)
    if existing is None and data.get("mode") is None:
        data.pop("mode", None)
    row, _ = owned_repo.upsert(ctx, FocusSession, row_id, data)
    return recompute(ctx, row)


def upsert_segment_sync(
    ctx: Ctx, row_id: uuid.UUID, payload: SegmentSyncIn
) -> FocusSegment:
    data = payload.model_dump(exclude_unset=True)
    existing = owned_repo.get(ctx, FocusSegment, row_id, include_deleted=True)
    session_id = data.get("session_id") or (existing.session_id if existing else None)
    if session_id is None:
        raise invalid("missing_fields", "A segment needs a session")
    if existing is not None and data.get("session_id") not in (
        None,
        existing.session_id,
    ):
        raise invalid("focus_segment_moved", "A segment can't move to another session")
    parent = owned_repo.get(ctx, FocusSession, session_id, include_deleted=True)
    if parent is None:
        raise not_found("Focus session")
    _check_item(data, existing)
    _check_range(data, existing)
    row, _ = owned_repo.upsert(ctx, FocusSegment, row_id, data)
    recompute(ctx, parent)
    return row


def delete_session(ctx: Ctx, *, session_id: uuid.UUID) -> None:
    row = require_session(ctx, session_id)
    for s in segment_rows(ctx, [row.id]):
        owned_repo.soft_delete(ctx, s)
    owned_repo.soft_delete(ctx, row)
    ctx.commit()


def delete_segment(ctx: Ctx, *, segment_id: uuid.UUID) -> None:
    seg = owned_repo.require(ctx, FocusSegment, segment_id, what="Focus segment")
    owned_repo.soft_delete(ctx, seg)
    parent = owned_repo.get(ctx, FocusSession, seg.session_id, include_deleted=True)
    if parent is not None:
        recompute(ctx, parent)
    ctx.commit()


# ---------------------------------------------------------------- actions


def item_ref(ctx: Ctx, ref: ItemRef | None) -> L.Item | None:
    """Resolve a picked task or habit (404 when it is not the caller's), with
    its current title."""
    if ref is None:
        return None
    from app.modules.habits.models import Habit
    from app.modules.tasks.models import Task

    if ref.kind == "task":
        task = owned_repo.require(ctx, Task, ref.id, what="Task")
        return L.Item("task", task.id, task.title[:160])
    habit = owned_repo.require(ctx, Habit, ref.id, what="Habit")
    return L.Item("habit", habit.id, habit.name[:160])


def start(ctx: Ctx, *, body: StartIn) -> FocusSession:
    """Start a session now. One already running ends first (kept)."""
    running = current_row(ctx)
    if running is not None and body.id is not None and running.id == body.id:
        return running
    if running is not None:
        _save(ctx, running, L.stop(load(ctx, running), ctx.now))
    st = get_settings(ctx)
    mode = body.mode or cast(L.Mode, st.mode)
    preset = (
        body.preset
        if body.preset is not None
        else (st.preset if body.mode is None else None)
    )
    if preset and preset in L.PRESETS:
        lengths = L.PRESETS[preset]
    else:
        lengths = (
            st.focus_min,
            st.short_break_min,
            st.long_break_min,
            st.sets_before_long,
        )
    lengths = (
        body.focus_min or lengths[0],
        body.short_break_min or lengths[1],
        body.long_break_min or lengths[2],
        body.sets_before_long or lengths[3],
    )
    custom = any(
        x is not None
        for x in (
            body.focus_min,
            body.short_break_min,
            body.long_break_min,
            body.sets_before_long,
        )
    )
    sid = body.id or uuid.uuid4()
    if owned_repo.get(ctx, FocusSession, sid, include_deleted=True) is not None:
        raise conflict("focus_session_exists", "That session already exists")
    tl = L.start(
        session_id=sid,
        segment_id=uuid.uuid4(),
        mode=mode,
        lengths=lengths,
        auto_start_breaks=st.auto_start_breaks,
        auto_start_focus=st.auto_start_focus,
        item=item_ref(ctx, body.item),
        now=ctx.now,
    )
    row = _save(ctx, None, tl)
    row.preset = (
        None if mode == "stopwatch" else ("custom" if custom or not preset else preset)
    )
    ctx.session.add(row)
    ctx.commit()
    return row


def _act(ctx: Ctx, fn: Any) -> FocusSession:
    row = current_row(ctx)
    if row is None:
        raise not_found("Running focus session")
    out = _save(ctx, row, fn(load(ctx, row)))
    ctx.commit()
    return out


def pause(ctx: Ctx) -> FocusSession:
    return _act(ctx, lambda tl: L.pause(tl, ctx.now, uuid.uuid4))


def resume(ctx: Ctx) -> FocusSession:
    return _act(ctx, lambda tl: L.resume(tl, ctx.now, uuid.uuid4))


def start_next(ctx: Ctx) -> FocusSession:
    return _act(ctx, lambda tl: L.start_next(tl, ctx.now, uuid.uuid4))


def skip_break(ctx: Ctx) -> FocusSession:
    return _act(ctx, lambda tl: L.skip_break(tl, ctx.now, uuid.uuid4))


def extend(ctx: Ctx, *, sec: int) -> FocusSession:
    return _act(ctx, lambda tl: L.extend(tl, ctx.now, sec))


def switch(ctx: Ctx, *, item: ItemRef | None) -> FocusSession:
    picked = item_ref(ctx, item)
    return _act(ctx, lambda tl: L.switch(tl, ctx.now, picked, uuid.uuid4))


def stop(ctx: Ctx, *, abandon: bool = False) -> FocusSession:
    return _act(ctx, lambda tl: L.stop(tl, ctx.now, abandon=abandon))


# ---------------------------------------------------------------- reads


def _ref(item: L.Item | None) -> ItemRef | None:
    return ItemRef(kind=item.kind, id=item.id, title=item.title) if item else None


def phase_out(tl: L.Timeline, now: datetime) -> PhaseOut:
    p = L.phase(tl, now)
    return PhaseOut(
        status=p.status,
        kind=p.kind,
        set_index=p.set_index,
        planned_sec=p.planned_sec,
        elapsed_sec=int(p.elapsed),
        remaining_sec=None if p.remaining is None else int(p.remaining + 0.999),
        long_break=p.long_break,
        ends_at=p.ends_at,
        item=_ref(p.item),
    )


def detail(ctx: Ctx, row: FocusSession) -> SessionDetail:
    tl = load(ctx, row)
    base = SessionPublic.model_validate(row).model_dump()
    base["focus_sec"] = L.focus_sec(tl, ctx.now)
    base["sets_completed"] = L.sets_completed(tl, ctx.now)
    segs = {s.id: s for s in segment_rows(ctx, [row.id])}
    out_segs = []
    for s in tl.segs:
        stored = segs.get(s.id)
        out_segs.append(
            SegmentPublic(
                id=s.id,
                session_id=row.id,
                kind=s.kind,
                started_at=s.started_at,
                ended_at=s.ended_at,
                set_index=s.set_index,
                planned_sec=s.planned_sec,
                item_kind=s.item.kind if s.item else None,
                item_id=s.item.id if s.item else None,
                item_title=s.item.title if s.item else None,
                version=stored.version if stored else 0,
            )
        )
    return SessionDetail(**base, segments=out_segs, phase=phase_out(tl, ctx.now))


def current(ctx: Ctx) -> SessionDetail | None:
    row = current_row(ctx)
    return detail(ctx, row) if row is not None else None


def goal_sec(ctx: Ctx) -> int:
    return get_settings(ctx).daily_goal_min * 60


@dataclass(frozen=True)
class Range:
    first: date
    last: date
    by_day: dict[date, int]
    spans: list[L.Focused]
    sessions: list[tuple[FocusSession, L.Timeline]]


def focus_range(ctx: Ctx, first: date, last: date) -> Range:
    lo, hi = ctx.clock.window(first, last)
    sessions = timelines(ctx, lo, hi)
    spans = [
        L.Focused(max(f.start, lo), min(f.end, hi), f.item, f.session_id)
        for f in L.counted((tl for _, tl in sessions), ctx.now)
        if f.end > lo and f.start < hi
    ]
    return Range(first, last, L.per_day(spans, ctx.clock, first, last), spans, sessions)


def first_day(ctx: Ctx) -> date | None:
    """The business day of the person's first session that counts."""
    rows = owned_repo.list_rows(
        ctx,
        FocusSession,
        or_(
            col(FocusSession.end_reason).is_(None),
            col(FocusSession.end_reason) != "abandoned",
        ),
        order_by=[col(FocusSession.started_at)],
        limit=1,
    )
    return ctx.clock.day_of(rows[0].started_at) if rows else None


def item_totals(spans: list[L.Focused]) -> list[tuple[L.Item | None, int]]:
    titles: dict[tuple[str, uuid.UUID], L.Item] = {}
    for f in sorted(spans, key=lambda f: f.start):
        if f.item:
            titles[(f.item.kind, f.item.id)] = f.item
    totals = L.per_item(spans)
    out = [(titles[k] if k else None, v) for k, v in totals.items() if v > 0]
    return sorted(out, key=lambda x: (-x[1], x[0].title or "" if x[0] else "~"))


def item_times(spans: list[L.Focused]) -> list[ItemTime]:
    return [
        ItemTime(item=_ref(item), focus_sec=sec) for item, sec in item_totals(spans)
    ]


def streaks(ctx: Ctx, days: int = 400) -> tuple[int, int]:
    """(current, best) runs of days on goal over the last ``days``."""
    g = goal_sec(ctx)
    if g <= 0:
        return 0, 0
    today = ctx.today
    by_day = focus_range(ctx, today - timedelta(days=days - 1), today).by_day
    best = run = 0
    for d in sorted(by_day):
        run = run + 1 if by_day[d] >= g else 0
        best = max(best, run)
    return L.goal_streak(by_day, g, today), best


def day_blocks(ctx: Ctx, day: date) -> tuple[datetime, datetime, list[Block]]:
    lo, hi = ctx.clock.window(day, day)
    blocks: list[Block] = []
    for row, tl in timelines(ctx, lo, hi):
        for s in tl.segs:
            end = L.end_of(s, ctx.now)
            for a, b in L.clip([(s.started_at, end)], lo, hi):
                if b <= a:
                    continue
                blocks.append(
                    Block(
                        session_id=row.id,
                        segment_id=s.id,
                        kind=s.kind,
                        start=a,
                        end=b,
                        running=s.ended_at is None,
                        abandoned=tl.sess.end_reason == "abandoned",
                        item=_ref(s.item),
                    )
                )
    blocks.sort(key=lambda b: b.start)
    return lo, hi, blocks


def item_time(
    ctx: Ctx, *, kind: Literal["task", "habit"], item_id: uuid.UUID
) -> ItemTimeOut:
    """All-time, today's and this week's focus on one item, and its recent
    sessions (newest first)."""
    from app.modules.habits.models import Habit
    from app.modules.tasks.models import Task

    estimate: int | None = None
    if kind == "task":
        task = owned_repo.get(ctx, Task, item_id, include_deleted=True)
        if task is None:
            raise not_found("Task")
        title = task.title
        estimate = getattr(task, "estimate_min", None)
    else:
        habit = owned_repo.get(ctx, Habit, item_id, include_deleted=True)
        if habit is None:
            raise not_found("Habit")
        title = habit.name
        if habit.type == "duration" and habit.target:
            estimate = int(habit.target)
    seg_rows = owned_repo.list_rows(
        ctx,
        FocusSegment,
        col(FocusSegment.item_id) == item_id,
        col(FocusSegment.kind) == "focus",
    )
    sess_ids = list({s.session_id for s in seg_rows})
    sessions = {
        r.id: r
        for r in owned_repo.list_rows(ctx, FocusSession, col(FocusSession.id).in_(sess_ids))
    } if sess_ids else {}  # fmt: skip
    spans: list[L.Focused] = []
    per_session: dict[uuid.UUID, list[L.Span]] = {}
    for s in seg_rows:
        parent = sessions.get(s.session_id)
        if parent is None or parent.end_reason == "abandoned":
            continue
        seg = to_seg(s)
        end = L.end_of(seg, ctx.now)
        spans.append(L.Focused(seg.started_at, end, seg.item, parent.id))
        per_session.setdefault(parent.id, []).append((seg.started_at, end))
    total = sum(L.per_item(spans).values())
    today = ctx.today
    week = L.per_day(spans, ctx.clock, today - timedelta(days=6), today)
    recent = sorted(
        (
            ItemSession(
                session_id=sid,
                day=sessions[sid].day or ctx.clock.day_of(sessions[sid].started_at),
                started_at=sessions[sid].started_at,
                focus_sec=int(sum(L.sec(a, b) for a, b in L.union(v))),
            )
            for sid, v in per_session.items()
        ),
        key=lambda x: x.started_at,
        reverse=True,
    )[:10]
    return ItemTimeOut(
        item=ItemRef(kind=kind, id=item_id, title=title),
        focus_sec=total,
        today_sec=week.get(today, 0),
        week_sec=sum(week.values()),
        estimate_min=estimate,
        recent=recent,
    )


def today_view(ctx: Ctx) -> TodayOut:
    day = ctx.today
    r = focus_range(ctx, day, day)
    lo, hi = ctx.clock.window(day, day)
    started = [row for row, _ in r.sessions if lo <= row.started_at < hi]
    streak, _ = streaks(ctx)
    return TodayOut(
        day=day,
        goal_min=get_settings(ctx).daily_goal_min,
        focus_sec=r.by_day.get(day, 0),
        sets_completed=sum(
            L.sets_completed(tl, ctx.now)
            for row, tl in r.sessions
            if lo <= row.started_at < hi and row.end_reason != "abandoned"
        ),
        sessions=sum(1 for row in started if row.end_reason != "abandoned"),
        streak=streak,
        items=item_times(r.spans),
        current=current(ctx),
    )
