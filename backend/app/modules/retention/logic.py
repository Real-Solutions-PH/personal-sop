"""The retention rules (docs/26-retention-algorithms.md §3, Slice 1): pure,
no database, no clock of their own.

- When a person is usually in the app: a half-hour histogram of their
  engagement moments (app opens and logs) over 60 days, each weighted by a
  14-day half-life, one per (local day, slot), smoothed, and the best slot
  among those an engagement nudge may use.
- Where they are in the lifecycle (``stage_of``) and how likely they are to
  leave (``risk_score``): rules, not a model (decision D6).
- Which nudge, if any, today holds: the best-time nudge on an ordinary day,
  a ladder step on days 3, 7, 14 and 30 after the last log, nothing between
  (``kind_for``), and every reason it may be held back (``decide``).

Every day here is the person's own business day (``DayClock``); every
minute of day is their local wall clock.
"""

import hashlib
import uuid
from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from typing import Literal
from zoneinfo import ZoneInfo

from app.shared.day import parse_hm

SLOTS = 48
HALF_LIFE_DAYS = 14
HISTORY_DAYS = 60
# Below this much decayed weight a histogram says too little: cold start.
COLD_START_WEIGHT = 5.0
# A nudge arrives this long before the slot it targets.
LEAD_MINUTES = 10
# Engagement nudges never go out before 07:00 or after 21:30 local, even
# with no quiet hours set (§6).
WINDOW_START = 7 * 60
WINDOW_END = 21 * 60 + 30
# Nor this close to a reminder the person set.
REMINDER_GAP = 45
DEFAULT_SLOT_HM = "19:00"

DayType = Literal["weekday", "weekend"]
Stage = Literal["new", "lapsed", "lapsing", "returning", "steady", "drifting"]
NudgeKind = Literal["best_time", "ladder_3", "ladder_7", "ladder_14", "ladder_30"]
Mode = Literal["daily", "weekly", "off"]
Arm = Literal["holdout", "treated"]

LADDER: dict[int, NudgeKind] = {
    3: "ladder_3",
    7: "ladder_7",
    14: "ladder_14",
    30: "ladder_30",
}
# The day-30 note goes only to people who had this many log days in all.
LADDER_30_MIN_LOG_DAYS = 7
# A gap this long (days between two log days) makes the later one a return;
# the same 3 days that make someone ``lapsing``.
RETURN_GAP = 3
RETURNING_DAYS = 7

IGNORE_AFTER = timedelta(hours=6)
OPEN_COUNTS_WITHIN = timedelta(hours=2)
FATIGUE_STOP = 4
REMINDERS_CAP = 4

HOLDOUT_PERCENT = 10
EXPERIMENT_SALT = "retention-2026-11"


# ---------------------------------------------------------------- slots


def slot_of_minute(minute: int) -> int:
    return (minute // 30) % SLOTS


def slot_of_hm(hm: str) -> int:
    h, m = parse_hm(hm)
    return slot_of_minute(h * 60 + m)


def slot_hm(slot: int) -> str:
    minute = slot * 30
    return f"{minute // 60:02d}:{minute % 60:02d}"


def send_minute(slot: int) -> int:
    """The local minute a nudge for ``slot`` goes out: just before it."""
    return max(WINDOW_START, slot * 30 - LEAD_MINUTES)


def day_type(d: date) -> DayType:
    return "weekend" if d.weekday() >= 5 else "weekday"


def slot_histogram(
    moments: Iterable[datetime], *, now: datetime, zone: ZoneInfo
) -> dict[str, list[float]]:
    """``{"weekday": [48], "weekend": [48]}`` of decayed engagement weight.

    A moment counts by its LOCAL calendar date and time (a Saturday morning
    in Manila is a Friday night in UTC). One moment per (date, slot): a long
    session in one half-hour counts once, at its newest moment's weight.
    """
    best: dict[tuple[date, int], float] = {}
    for m in moments:
        age = (now - m).total_seconds() / 86_400
        if age < 0 or age > HISTORY_DAYS:
            continue
        local = m.astimezone(zone)
        key = (local.date(), slot_of_minute(local.hour * 60 + local.minute))
        weight = 0.5 ** (age / HALF_LIFE_DAYS)
        if weight > best.get(key, 0.0):
            best[key] = weight
    out: dict[str, list[float]] = {
        "weekday": [0.0] * SLOTS,
        "weekend": [0.0] * SLOTS,
    }
    for (d, s), w in best.items():
        out[day_type(d)][s] += w
    return out


def smooth(h: Sequence[float]) -> list[float]:
    """A circular 1/4, 1/2, 1/4 blur: a habit at 19:25 also lends weight to
    19:00 and 19:30."""
    n = len(h)
    return [
        0.25 * h[(s - 1) % n] + 0.5 * h[s] + 0.25 * h[(s + 1) % n] for s in range(n)
    ]


def in_quiet(minute: int, quiet_start: str, quiet_end: str) -> bool:
    """Is ``minute`` inside ``[start, end)``? Windows may wrap midnight; an
    empty window (start == end) is never quiet."""
    sh, sm = parse_hm(quiet_start)
    eh, em = parse_hm(quiet_end)
    start, end = sh * 60 + sm, eh * 60 + em
    if start == end:
        return False
    if start < end:
        return start <= minute < end
    return minute >= start or minute < end


def eligible_slots(
    *, quiet_start: str, quiet_end: str, reminders: Sequence[int]
) -> list[bool]:
    """Slots an engagement nudge may target: the whole half-hour inside
    07:00-21:30, neither its start nor its send time in quiet hours, and the
    send time at least 45 min from every reminder set for today (minutes of
    the local day)."""
    out = []
    for s in range(SLOTS):
        start = s * 30
        send = send_minute(s)
        ok = (
            start >= WINDOW_START
            and start + 30 <= WINDOW_END
            and not in_quiet(start, quiet_start, quiet_end)
            and not in_quiet(send, quiet_start, quiet_end)
            and all(abs(send - r) >= REMINDER_GAP for r in reminders)
        )
        out.append(ok)
    return out


def best_slot(
    hist: Sequence[float],
    eligible: Sequence[bool],
    *,
    push_evening: str | None,
    push_morning: str | None,
) -> int | None:
    """The eligible slot with the most smoothed weight (earliest on a tie).

    Cold start (too little history, or none of it near an eligible slot):
    the evening push time the person chose in onboarding, else the morning
    one, else 19:00, whichever is eligible first. None: no slot is.
    """
    if sum(hist) >= COLD_START_WEIGHT:
        sm = smooth(hist)
        scored = [(sm[s], -s) for s in range(SLOTS) if eligible[s]]
        if scored and max(scored)[0] > 0:
            return -max(scored)[1]
    for hm in (push_evening, push_morning, DEFAULT_SLOT_HM):
        if hm:
            s = slot_of_hm(hm)
            if eligible[s]:
                return s
    return None


# ---------------------------------------------------------------- stage, risk


def last_log_day(log_days: Iterable[date]) -> date | None:
    return max(log_days, default=None)


def days_since(today: date, day: date | None) -> int | None:
    return None if day is None else (today - day).days


def _return_day(log_days: set[date]) -> date | None:
    """The latest log day that came after a gap of ``RETURN_GAP``+ days."""
    ordered = sorted(log_days)
    for prev, cur in zip(reversed(ordered[:-1]), reversed(ordered[1:]), strict=True):
        if (cur - prev).days >= RETURN_GAP:
            return cur
    return None


def stage_of(*, today: date, signup_day: date, log_days: set[date]) -> Stage:
    """The §3.1 stage table, rules evaluated in order."""
    if (today - signup_day).days <= 13:
        return "new"
    since = days_since(today, last_log_day(log_days))
    if since is None or since >= 15:
        return "lapsed"
    if since >= 3:
        return "lapsing"
    back = _return_day(log_days)
    if back is not None and (today - back).days < RETURNING_DAYS:
        return "returning"
    recent = sum(1 for d in log_days if 0 <= (today - d).days < 14)
    if recent >= 8:
        return "steady"
    return "drifting"


def _since_points(since: int | None) -> int:
    if since is None or since >= 8:
        return 70
    if since >= 5:
        return 55
    if since >= 3:
        return 40
    return (0, 10, 25)[since]


def risk_score(
    *,
    today: date,
    signup_day: date,
    log_days: set[date],
    ignore_streak: int,
    areas_28d: int,
) -> int:
    """The §3.3 points table, 0-100."""
    since = days_since(today, last_log_day(log_days))
    pts = _since_points(since)
    last7 = sum(1 for d in log_days if 0 <= (today - d).days < 7)
    prev21 = sum(1 for d in log_days if 7 <= (today - d).days < 28)
    if last7 < (prev21 / 3) / 2:
        pts += 10
    if ignore_streak >= 3:
        pts += 10
    if areas_28d == 1:
        pts += 5
    day1 = signup_day + timedelta(days=1)
    if (today - signup_day).days <= 13 and today > day1 and day1 not in log_days:
        pts += 5
    return min(100, pts)


# ---------------------------------------------------------------- nudges


def ladder_kind(days_since_log: int, *, lifetime_log_days: int) -> NudgeKind | None:
    kind = LADDER.get(days_since_log)
    if kind == "ladder_30" and lifetime_log_days < LADDER_30_MIN_LOG_DAYS:
        return None
    return kind


def kind_for(days_since_log: int | None, *, lifetime_log_days: int) -> NudgeKind | None:
    """Today's candidate: the best-time nudge while the person logged
    yesterday or today (or never yet), a ladder step on its day, else none:
    day 1 is the grace day's and day 2 belongs to the way-back screen."""
    if days_since_log is None or days_since_log <= 1:
        return "best_time"
    return ladder_kind(days_since_log, lifetime_log_days=lifetime_log_days)


def ignore_streak(
    sent: Sequence[tuple[datetime, datetime | None]],
    *,
    app_opens: Sequence[datetime],
    now: datetime,
) -> int:
    """Consecutive ignored nudges, newest first. ``sent``: (sent_at,
    opened_at). Ignored = not opened within 6 h and no app open within 2 h;
    one younger than 6 h is not judged yet."""
    k = 0
    for sent_at, opened_at in sorted(sent, key=lambda x: x[0], reverse=True):
        if now - sent_at < IGNORE_AFTER:
            continue
        opened = opened_at is not None and opened_at - sent_at <= IGNORE_AFTER
        came = any(sent_at <= o <= sent_at + OPEN_COUNTS_WITHIN for o in app_opens)
        if opened or came:
            break
        k += 1
    return k


def next_nudge_after(last_sent: date | None, k: int) -> date | None:
    """After ``k`` ignores in a row the next nudge waits 2^k - 1 extra days
    beyond the next day: 0, 1, 3, 7."""
    if last_sent is None or k <= 0:
        return None
    return last_sent + timedelta(days=2**k)


def arm_of(user_id: uuid.UUID) -> Arm:
    """Stable assignment: 10% get no engagement nudges (the holdout)."""
    digest = hashlib.sha256(f"{EXPERIMENT_SALT}:{user_id}".encode()).hexdigest()
    return "holdout" if int(digest, 16) % 100 < HOLDOUT_PERCENT else "treated"


def weekly_cap(mode: Mode, stage: str) -> int:
    if mode == "weekly":
        return 1
    if stage == "lapsing":
        return 3
    return 4


@dataclass(frozen=True)
class Decision:
    kind: NudgeKind
    # None: send it. Otherwise why it was held back.
    suppressed: str | None


def decide(
    *,
    mode: Mode,
    stage: str,
    days_since_log: int | None,
    lifetime_log_days: int,
    active_today: bool,
    in_quiet: bool,
    ignore_streak: int,
    next_nudge_after: date | None,
    today: date,
    sent_last_7: int,
    reminders_today: int,
    has_content: bool,
    holdout: bool,
) -> Decision | None:
    """Today's engagement nudge and, if it is held back, why (§3.5).

    None: nothing to consider today. The order matters: the holdout comes
    last so a ``holdout`` row means "would have been sent"."""
    kind = kind_for(days_since_log, lifetime_log_days=lifetime_log_days)
    if kind is None:
        return None
    if mode == "off":
        return Decision(kind, "opt_out")
    if active_today or days_since_log == 0:
        return Decision(kind, "active_today")
    if in_quiet:
        return Decision(kind, "quiet")
    if ignore_streak >= FATIGUE_STOP:
        return Decision(kind, "fatigue")
    if next_nudge_after is not None and today < next_nudge_after:
        return Decision(kind, "backoff")
    if sent_last_7 >= weekly_cap(mode, stage) or reminders_today >= REMINDERS_CAP:
        return Decision(kind, "budget")
    if not has_content:
        return Decision(kind, "no_content")
    if holdout:
        return Decision(kind, "holdout")
    return Decision(kind, None)
