"""The focus timer's rules, as pure functions of a session's segments and
an instant (ADR-0025). No database access: ``services.py`` loads rows into
these shapes, and ``shared/prototype/focus/logic.ts`` is the same code on the
device, so a timer read on the phone, by Fern or by the stats agrees.

The timer is never a counter. Where it stands at ``now`` follows from the
stored timestamps: a focus set ends ``planned_sec`` of focus after it began
(pauses excluded), and a break ends the same way. :func:`advance` writes down
the transitions that came due while nobody was looking (the app was killed,
the phone was locked): it closes a finished set at the instant it finished
and, when the session auto-starts, opens the break or the next set at that
same instant.

Rules decided in ADR-0025:

- Auto-start cycles stop at a long break: after it the timer waits, so a
  session left running never accrues more than one round unattended.
- A segment left open longer than :data:`MAX_OPEN` (a stopwatch, or a pause
  nobody resumed) is closed at that cap and the session ends there.
- An ended session with less than :data:`MIN_FOCUS_SEC` of focus is
  recorded as abandoned (an accidental tap).
- An abandoned session's time counts nowhere: not in the day's focus, the
  goal, or an item's time. Ending early keeps everything done so far.
- Focus time is counted once however many sessions cover it (two devices
  both running): per-day and per-item totals are over the union of the
  intervals.
"""

import math
import uuid
from collections.abc import Callable, Iterable, Sequence
from dataclasses import dataclass, replace
from datetime import date, datetime, timedelta
from typing import Literal

from app.shared.day import DayClock, days_between
from app.shared.ids import derived_id

Kind = Literal["focus", "break", "pause"]
Mode = Literal["pomodoro", "stopwatch"]
Status = Literal["running", "paused", "waiting", "ended"]

MAX_OPEN = timedelta(hours=12)
MIN_FOCUS_SEC = 60

# key -> (focus, short break, long break, sets before the long break)
PRESETS: dict[str, tuple[int, int, int, int]] = {
    "25-5": (25, 5, 15, 4),
    "50-10": (50, 10, 20, 3),
    "90-20": (90, 20, 30, 2),
}


@dataclass(frozen=True)
class Item:
    kind: Literal["task", "habit"]
    id: uuid.UUID
    title: str | None = None


@dataclass(frozen=True)
class Seg:
    id: uuid.UUID
    kind: Kind
    started_at: datetime
    ended_at: datetime | None = None
    set_index: int = 0
    planned_sec: int | None = None
    item: Item | None = None


@dataclass(frozen=True)
class Sess:
    id: uuid.UUID
    mode: Mode
    started_at: datetime
    focus_min: int = 25
    short_break_min: int = 5
    long_break_min: int = 15
    sets_before_long: int = 4
    auto_start_breaks: bool = True
    auto_start_focus: bool = False
    ended_at: datetime | None = None
    end_reason: Literal["completed", "abandoned"] | None = None
    item: Item | None = None


@dataclass(frozen=True)
class Timeline:
    """A session and its segments, ordered by start."""

    sess: Sess
    segs: tuple[Seg, ...]


def sec(a: datetime, b: datetime) -> float:
    return (b - a).total_seconds()


def ordered(segs: Iterable[Seg]) -> tuple[Seg, ...]:
    return tuple(sorted(segs, key=lambda s: (s.started_at, s.id.int)))


def is_long_break(sess: Sess, set_index: int) -> bool:
    return (set_index + 1) % sess.sets_before_long == 0


def break_sec(sess: Sess, set_index: int) -> int:
    return (
        sess.long_break_min if is_long_break(sess, set_index) else sess.short_break_min
    ) * 60


def focus_planned(sess: Sess) -> int | None:
    return sess.focus_min * 60 if sess.mode == "pomodoro" else None


def _open(segs: Sequence[Seg]) -> Seg | None:
    return next((s for s in reversed(segs) if s.ended_at is None), None)


def _done(segs: Sequence[Seg], kind: Kind, set_index: int, *, skip: uuid.UUID) -> float:
    """Closed seconds of ``kind`` in a set, leaving one segment out."""
    return sum(
        sec(s.started_at, s.ended_at)
        for s in segs
        if s.kind == kind and s.set_index == set_index and s.ended_at and s.id != skip
    )


def normalise(segs: Sequence[Seg]) -> tuple[Seg, ...]:
    """At most one open segment: an open one followed by a later segment
    (two devices each opened one) ends where the next begins."""
    out = list(ordered(segs))
    for i, s in enumerate(out[:-1]):
        nxt = out[i + 1]
        if s.ended_at is None:
            out[i] = replace(s, ended_at=max(s.started_at, nxt.started_at))
    return tuple(out)


def auto_id(session_id: uuid.UUID, kind: Kind, set_index: int) -> uuid.UUID:
    """The id of a segment the timer opened by itself: the phone and the
    server both mint it, so one auto-started break is one row."""
    return derived_id("focus-segment", session_id, f"auto-{kind}-{set_index}")


def advance(tl: Timeline, now: datetime) -> Timeline:
    """``tl`` with every transition due by ``now`` written down."""
    sess = tl.sess
    segs = list(normalise(tl.segs))
    for _ in range(4 * sess.sets_before_long + 8):
        cur = _open(segs)
        if cur is None:
            break
        i = segs.index(cur)
        if sess.ended_at is not None:
            segs[i] = replace(cur, ended_at=max(cur.started_at, sess.ended_at))
            continue
        cap = cur.started_at + MAX_OPEN
        if cur.kind == "pause" or cur.planned_sec is None:
            if now > cap:
                segs[i] = replace(cur, ended_at=cap)
                sess = replace(sess, ended_at=cap, end_reason="completed")
            break
        left = cur.planned_sec - _done(segs, cur.kind, cur.set_index, skip=cur.id)
        end = cur.started_at + timedelta(seconds=max(0.0, left))
        if end > now:
            break
        segs[i] = replace(cur, ended_at=end)
        k = cur.set_index
        if cur.kind == "focus" and sess.auto_start_breaks:
            segs.append(
                Seg(
                    auto_id(sess.id, "break", k),
                    "break",
                    end,
                    None,
                    k,
                    break_sec(sess, k),
                )
            )
        elif (
            cur.kind == "break" and sess.auto_start_focus and not is_long_break(sess, k)
        ):
            segs.append(
                Seg(
                    auto_id(sess.id, "focus", k + 1), "focus", end, None, k + 1,
                    focus_planned(sess), sess.item,
                )
            )  # fmt: skip
    return Timeline(sess, ordered(segs))


# ---------------------------------------------------------------- reading


@dataclass(frozen=True)
class Phase:
    """Where the timer stands. ``kind`` is what runs (or, when waiting, what
    comes next); ``elapsed``/``remaining`` are seconds of that phase."""

    status: Status
    kind: Literal["focus", "break"]
    set_index: int
    planned_sec: int | None
    elapsed: float
    remaining: float | None
    long_break: bool
    # Epoch-free: the instant the phase ends if nothing changes (running only).
    ends_at: datetime | None
    item: Item | None


def _resume_kind(segs: Sequence[Seg], pause: Seg) -> Literal["focus", "break"]:
    before = [s for s in segs if s.started_at <= pause.started_at and s.kind != "pause"]
    return "break" if before and before[-1].kind == "break" else "focus"


def phase(tl: Timeline, now: datetime) -> Phase:
    """Read the timer at ``now`` (call on an :func:`advance`d timeline)."""
    sess, segs = tl.sess, tl.segs
    cur = _open(segs)
    if sess.ended_at is not None or (cur is None and not segs):
        status: Status = "ended" if sess.ended_at is not None else "waiting"
        return Phase(
            status, "focus", 0, focus_planned(sess), 0.0, None, False, None, sess.item
        )
    if cur is not None:
        kind: Literal["focus", "break"] = (
            _resume_kind(segs, cur) if cur.kind == "pause" else cur.kind
        )
        k = cur.set_index
        done = _done(segs, kind, k, skip=cur.id)
        running = cur.kind != "pause"
        elapsed = done + (sec(cur.started_at, now) if running else 0.0)
        planned = cur.planned_sec
        remaining = None if planned is None else max(0.0, planned - elapsed)
        ends = (
            now + timedelta(seconds=remaining)
            if running and remaining is not None
            else None
        )
        return Phase(
            "running" if running else "paused", kind, k, planned, elapsed, remaining,
            kind == "break" and is_long_break(sess, k), ends, cur.item or sess.item,
        )  # fmt: skip
    last = segs[-1]
    k = last.set_index
    if last.kind == "focus" or (
        last.kind == "pause" and _resume_kind(segs, last) == "focus"
    ):
        planned = break_sec(sess, k)
        return Phase("waiting", "break", k, planned, 0.0, float(planned),
                     is_long_break(sess, k), None, sess.item)  # fmt: skip
    planned_f = focus_planned(sess)
    return Phase("waiting", "focus", k + 1, planned_f, 0.0,
                 None if planned_f is None else float(planned_f), False, None, sess.item)  # fmt: skip


def focus_sec(tl: Timeline, now: datetime) -> int:
    """Seconds of focus in the session (open segment up to ``now``)."""
    spans = [(s.started_at, end_of(s, now)) for s in tl.segs if s.kind == "focus"]
    return math.floor(sum(sec(a, b) for a, b in union(spans)))


def sets_completed(tl: Timeline, now: datetime) -> int:
    if tl.sess.mode != "pomodoro":
        return 0
    done: dict[int, float] = {}
    planned: dict[int, int] = {}
    for s in tl.segs:
        if s.kind != "focus":
            continue
        done[s.set_index] = done.get(s.set_index, 0.0) + sec(
            s.started_at, end_of(s, now)
        )
        if s.planned_sec is not None:
            planned[s.set_index] = s.planned_sec
    # A second of slack: a set closed by the timer ends on its planned instant.
    return sum(1 for k, v in done.items() if k in planned and v + 1 >= planned[k])


# ---------------------------------------------------------------- actions

NewId = Callable[[], uuid.UUID]


def start(
    *,
    session_id: uuid.UUID,
    segment_id: uuid.UUID,
    mode: Mode,
    lengths: tuple[int, int, int, int],
    auto_start_breaks: bool,
    auto_start_focus: bool,
    item: Item | None,
    now: datetime,
) -> Timeline:
    f, sb, lb, n = lengths
    sess = Sess(session_id, mode, now, f, sb, lb, n, auto_start_breaks, auto_start_focus,
                item=item)  # fmt: skip
    return Timeline(
        sess, (Seg(segment_id, "focus", now, None, 0, focus_planned(sess), item),)
    )


def _close_open(segs: list[Seg], now: datetime) -> Seg | None:
    cur = _open(segs)
    if cur is not None:
        segs[segs.index(cur)] = replace(cur, ended_at=max(cur.started_at, now))
    return cur


def pause(tl: Timeline, now: datetime, new_id: NewId) -> Timeline:
    tl = advance(tl, now)
    segs = list(tl.segs)
    cur = _open(segs)
    if tl.sess.ended_at is not None or cur is None or cur.kind == "pause":
        return tl
    _close_open(segs, now)
    segs.append(
        Seg(new_id(), "pause", now, None, cur.set_index, cur.planned_sec, cur.item)
    )
    return Timeline(tl.sess, ordered(segs))


def resume(tl: Timeline, now: datetime, new_id: NewId) -> Timeline:
    tl = advance(tl, now)
    segs = list(tl.segs)
    cur = _open(segs)
    if tl.sess.ended_at is not None or cur is None or cur.kind != "pause":
        return tl
    kind = _resume_kind(segs, cur)
    _close_open(segs, now)
    item = tl.sess.item if kind == "focus" else None
    segs.append(Seg(new_id(), kind, now, None, cur.set_index, cur.planned_sec, item))
    return Timeline(tl.sess, ordered(segs))


def start_next(tl: Timeline, now: datetime, new_id: NewId) -> Timeline:
    """Begin what comes next when the timer is waiting (between phases)."""
    tl = advance(tl, now)
    p = phase(tl, now)
    if p.status != "waiting":
        return tl
    item = tl.sess.item if p.kind == "focus" else None
    seg = Seg(new_id(), p.kind, now, None, p.set_index, p.planned_sec, item)
    return Timeline(tl.sess, ordered([*tl.segs, seg]))


def skip_break(tl: Timeline, now: datetime, new_id: NewId) -> Timeline:
    """End (or skip) the break and start the next focus set now."""
    tl = advance(tl, now)
    p = phase(tl, now)
    if tl.sess.ended_at is not None or p.kind != "break":
        return tl
    segs = list(tl.segs)
    _close_open(segs, now)
    seg = Seg(new_id(), "focus", now, None, p.set_index + 1, focus_planned(tl.sess),
              tl.sess.item)  # fmt: skip
    return Timeline(tl.sess, ordered([*segs, seg]))


def extend(tl: Timeline, now: datetime, by_sec: int) -> Timeline:
    """Add ``by_sec`` to the running (or paused) set or break."""
    tl = advance(tl, now)
    segs = list(tl.segs)
    cur = _open(segs)
    if tl.sess.ended_at is not None or cur is None or cur.planned_sec is None:
        return tl
    planned = min(86400, cur.planned_sec + by_sec)
    k = cur.set_index
    kind = _resume_kind(segs, cur) if cur.kind == "pause" else cur.kind
    # Every segment of the set carries the set's length; keep them agreeing.
    segs = [
        replace(s, planned_sec=planned)
        if s.set_index == k and (s.kind == kind or s.kind == "pause")
        else s
        for s in segs
    ]
    return Timeline(tl.sess, ordered(segs))


def switch(tl: Timeline, now: datetime, item: Item | None, new_id: NewId) -> Timeline:
    """Work on ``item`` from now on. A running focus segment is split here,
    so the time before and after the switch lands on the right item."""
    tl = advance(tl, now)
    sess = replace(tl.sess, item=item)
    segs = list(tl.segs)
    cur = _open(segs)
    if tl.sess.ended_at is not None or cur is None:
        return Timeline(sess, tl.segs)
    i = segs.index(cur)
    if cur.kind == "pause":
        segs[i] = replace(cur, item=item)
    elif cur.kind == "focus":
        if sec(cur.started_at, now) < 1:
            segs[i] = replace(cur, item=item)
        else:
            _close_open(segs, now)
            segs.append(
                Seg(new_id(), "focus", now, None, cur.set_index, cur.planned_sec, item)
            )
    return Timeline(sess, ordered(segs))


def stop(tl: Timeline, now: datetime, *, abandon: bool = False) -> Timeline:
    """End the session: keep what was done, or abandon it (counts nowhere).
    Less than a minute of focus is recorded as abandoned."""
    tl = advance(tl, now)
    if tl.sess.ended_at is not None:
        return tl
    segs = list(tl.segs)
    _close_open(segs, now)
    out = Timeline(tl.sess, ordered(segs))
    reason: Literal["completed", "abandoned"] = (
        "abandoned" if abandon or focus_sec(out, now) < MIN_FOCUS_SEC else "completed"
    )
    return Timeline(replace(tl.sess, ended_at=now, end_reason=reason), out.segs)


# ---------------------------------------------------------------- counting


def end_of(s: Seg, now: datetime) -> datetime:
    """Where a segment ends: its end, or ``now`` (capped) while it runs."""
    if s.ended_at is not None:
        return s.ended_at
    return max(s.started_at, min(now, s.started_at + MAX_OPEN))


Span = tuple[datetime, datetime]


def union(spans: Iterable[Span]) -> list[Span]:
    """Merge overlapping or touching spans; drops empty ones."""
    out: list[Span] = []
    for a, b in sorted(x for x in spans if x[1] > x[0]):
        if out and a <= out[-1][1]:
            out[-1] = (out[-1][0], max(out[-1][1], b))
        else:
            out.append((a, b))
    return out


def clip(spans: Iterable[Span], lo: datetime, hi: datetime) -> list[Span]:
    return [(max(a, lo), min(b, hi)) for a, b in spans if b > lo and a < hi]


@dataclass(frozen=True)
class Focused:
    """A focus span that counts: from a session not abandoned."""

    start: datetime
    end: datetime
    item: Item | None
    session_id: uuid.UUID


def counted(timelines: Iterable[Timeline], now: datetime) -> list[Focused]:
    out: list[Focused] = []
    for tl in timelines:
        if tl.sess.end_reason == "abandoned":
            continue
        for s in tl.segs:
            if s.kind == "focus":
                end = end_of(s, now)
                if end > s.started_at:
                    out.append(Focused(s.started_at, end, s.item, tl.sess.id))
    return out


def per_day(
    spans: Iterable[Focused], clock: DayClock, first: date, last: date
) -> dict[date, int]:
    """Whole seconds of focus on each business day ``first..last``, a span
    crossing the day boundary split at it, overlaps counted once."""
    merged = union((f.start, f.end) for f in spans)
    out: dict[date, int] = {}
    for d in days_between(first, last):
        lo, hi = clock.window(d, d)
        out[d] = math.floor(sum(sec(a, b) for a, b in clip(merged, lo, hi)))
    return out


def per_item(spans: Iterable[Focused]) -> dict[tuple[str, uuid.UUID] | None, int]:
    """Whole seconds per item (``None``: nothing picked), each item's own
    overlaps counted once."""
    groups: dict[tuple[str, uuid.UUID] | None, list[Span]] = {}
    for f in spans:
        key = (f.item.kind, f.item.id) if f.item else None
        groups.setdefault(key, []).append((f.start, f.end))
    return {
        k: math.floor(sum(sec(a, b) for a, b in union(v))) for k, v in groups.items()
    }


def goal_streak(by_day: dict[date, int], goal_sec: int, today: date) -> int:
    """Consecutive days on goal ending today (today counts once it is hit,
    and does not break the streak while still open)."""
    if goal_sec <= 0:
        return 0
    n = 0
    d = today
    if by_day.get(d, 0) < goal_sec:
        d -= timedelta(days=1)
    while by_day.get(d, 0) >= goal_sec:
        n += 1
        d -= timedelta(days=1)
    return n


def fmt_hm(seconds: float) -> str:
    """``1h 05m``, ``45m``, ``0m``: whole minutes, rounded down."""
    m = math.floor(seconds / 60)
    h, mm = divmod(m, 60)
    return f"{h}h {mm:02d}m" if h else f"{mm}m"
