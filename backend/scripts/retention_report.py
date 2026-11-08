"""Read-only retention report: the KPIs in docs/25-retention-kpis.md.

Reads the record tables, ``companion_message``, ``ai_usage``, ``user``,
``user_profile`` and (once it exists) ``usage_event`` inside a READ ONLY
transaction, and prints one line ``KPI <json>`` of aggregates. Nothing is
written, and no per-person row, id, email or record content is printed:
every figure is a count, a share or a median over people.

Run as a one-off ECS task on the backend image, like the Fern eval export
(docs/runbook.md, "Retention report"):

    python scripts/retention_report.py
    python scripts/retention_report.py --today 2026-11-08 --include-superusers

Locally it reads whatever database the backend settings point at.
"""

import argparse
import json
import statistics
import sys
import uuid
from collections import defaultdict
from collections.abc import Iterable
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone
from typing import Any
from zoneinfo import ZoneInfo

from sqlalchemy import Connection, text

# A "log" is a record the person made. Rows the app makes on its own are left
# out: habit logs completed from screen time, finance records the recurring
# job or a balance adjustment wrote. Fern chats are counted apart (a chat is
# not a log); captures are left out because each one writes records that are
# already counted here.
LOGS_SQL = """
WITH logs AS (
    SELECT owner_id, created_at AS at, 'habits' AS area
        FROM habit_log WHERE source <> 'screen'
    UNION ALL SELECT owner_id, created_at, 'habits' FROM routine_run
    UNION ALL SELECT owner_id, created_at, 'tasks' FROM task
    UNION ALL SELECT owner_id, completed_at, 'tasks'
        FROM task WHERE completed_at IS NOT NULL
    UNION ALL SELECT owner_id, created_at, 'fitness' FROM workout
    UNION ALL SELECT owner_id, created_at, 'fitness' FROM run_session
    UNION ALL SELECT owner_id, created_at, 'fitness' FROM weigh_in
    UNION ALL SELECT owner_id, created_at, 'nutrition' FROM meal
    UNION ALL SELECT owner_id, created_at, 'finance'
        FROM fin_record WHERE source NOT IN ('planned', 'adjustment')
    UNION ALL SELECT owner_id, created_at, 'focus' FROM focus_session
    UNION ALL SELECT owner_id, created_at, 'journal' FROM journal_entry
)
SELECT l.owner_id,
       (l.at AT TIME ZONE COALESCE(p.timezone, 'Asia/Manila'))::date AS day,
       l.area,
       count(*) AS n,
       min(l.at) AS first_at
FROM logs l
LEFT JOIN user_profile p ON p.owner_id = l.owner_id
GROUP BY 1, 2, 3
"""

USERS_SQL = """
SELECT u.id, u.created_at, u.is_superuser,
       COALESCE(p.timezone, 'Asia/Manila') AS tz,
       p.referral_source, COALESCE(p.onboarded, false) AS onboarded
FROM "user" u
LEFT JOIN user_profile p ON p.owner_id = u.id
WHERE u.created_at IS NOT NULL
"""

FERN_SQL = """
SELECT owner_id, count(*) AS n FROM companion_message
WHERE role = 'me' AND created_at >= :since GROUP BY 1
"""

AI_SQL = """
SELECT owner_id, count(*) AS calls, COALESCE(sum(cost_minor), 0) AS cost
FROM ai_usage WHERE at >= :since GROUP BY 1
"""

USAGE_SQL = """
SELECT owner_id, kind, at, detail FROM usage_event WHERE at >= :since
"""

LAPSE_DAYS = 3  # inactive this many whole days = lapsed
RETURN_WINDOW = 14  # days after lapsing in which a log counts as a return
SESSION_GAP = timedelta(minutes=30)  # opens closer than this are one session


@dataclass
class Person:
    id: uuid.UUID
    created_at: datetime
    tz: str
    referral: str | None
    onboarded: bool
    signup_day: date
    # local day -> area -> entries
    days: dict[date, dict[str, int]] = field(default_factory=dict)
    first_log_at: datetime | None = None


def _median(xs: list[float]) -> float | None:
    return round(statistics.median(xs), 2) if xs else None


def _share(num: int, den: int) -> dict[str, Any]:
    return {"n": num, "of": den, "pct": round(100 * num / den, 1) if den else None}


def week_start(d: date) -> date:
    return d - timedelta(days=d.weekday())


def lapses(log_days: list[date], today: date) -> list[tuple[date, bool | None]]:
    """Each lapse as (the day it began, returned within the window).

    A lapse begins on the first day after ``LAPSE_DAYS`` whole days with no
    log. It is a return when the next log falls within ``RETURN_WINDOW``
    days from that day (inclusive). ``None``: the window has not closed and
    no return yet, so it cannot be judged.
    """
    out: list[tuple[date, bool | None]] = []
    ordered = sorted(set(log_days))
    for i, last in enumerate(ordered):
        lapsed_on = last + timedelta(days=LAPSE_DAYS + 1)
        nxt = ordered[i + 1] if i + 1 < len(ordered) else None
        if nxt is not None and nxt < lapsed_on:
            continue  # came back before lapsing
        if nxt is None and today < lapsed_on:
            continue  # not lapsed yet
        window_end = lapsed_on + timedelta(days=RETURN_WINDOW - 1)
        if nxt is not None and nxt <= window_end:
            out.append((lapsed_on, True))
        elif today > window_end:
            out.append((lapsed_on, False))
        else:
            out.append((lapsed_on, None))
    return out


def retained(p: Person, n: int, span: int, today: date) -> bool | None:
    """Logged on any local day in [signup+n, signup+n+span). ``None``: that
    window has not fully passed yet."""
    start = p.signup_day + timedelta(days=n)
    end = start + timedelta(days=span - 1)
    if end >= today:
        return None
    return any(start <= d <= end for d in p.days)


def compute(
    people: Iterable[Person],
    today: date,
    fern: dict[uuid.UUID, int],
    ai: dict[uuid.UUID, tuple[int, int]],
    usage: list[tuple[uuid.UUID, str, datetime, str | None]] | None,
) -> dict[str, Any]:
    ppl = list(people)
    out: dict[str, Any] = {"today": today.isoformat(), "people": len(ppl)}
    out["onboarded"] = sum(p.onboarded for p in ppl)
    out["ever_logged"] = sum(bool(p.days) for p in ppl)

    # North star: weekly active loggers (3+ log days in a Mon-Sun week), the
    # last eight complete weeks plus the week so far.
    this_week = week_start(today)
    weeks = []
    for k in range(8, -1, -1):
        ws = this_week - timedelta(weeks=k)
        we = ws + timedelta(days=6)
        counts = [sum(ws <= d <= we for d in p.days) for p in ppl]
        active = [c for c in counts if c >= 1]
        weeks.append(
            {
                "week": ws.isoformat(),
                "complete": we < today,
                "signed_up_by_then": sum(p.signup_day <= we for p in ppl),
                "active_1plus": len(active),
                "wal_3plus": sum(c >= 3 for c in counts),
                "mean_log_days_of_active": round(statistics.mean(active), 2)
                if active
                else None,
            }
        )
    out["weeks"] = weeks

    # Cohort retention by signup week.
    cohorts: dict[date, list[Person]] = defaultdict(list)
    for p in ppl:
        cohorts[week_start(p.signup_day)].append(p)
    rows = []
    for ws in sorted(cohorts):
        grp = cohorts[ws]
        row: dict[str, Any] = {"cohort": ws.isoformat(), "size": len(grp)}
        for label, n, span in (("d1", 1, 1), ("d7", 7, 7), ("d30", 30, 7)):
            judged = [
                r for r in (retained(p, n, span, today) for p in grp) if r is not None
            ]
            row[label] = _share(sum(judged), len(judged))
        rows.append(row)
    out["cohorts"] = rows
    for label, n, span in (("d1", 1, 1), ("d7", 7, 7), ("d30", 30, 7)):
        judged = [
            r for r in (retained(p, n, span, today) for p in ppl) if r is not None
        ]
        out[f"all_{label}"] = _share(sum(judged), len(judged))

    # Last 28 days: depth of use.
    since = today - timedelta(days=28)
    active28 = [p for p in ppl if any(since <= d < today for d in p.days)]
    out["active_28d"] = len(active28)
    pairs = [
        (sum(a.values()), len(a))
        for p in active28
        for d, a in p.days.items()
        if since <= d < today
    ]
    out["entries_per_active_day"] = (
        round(sum(e for e, _ in pairs) / len(pairs), 2) if pairs else None
    )
    areas = [
        len({ar for d, a in p.days.items() if since <= d < today for ar in a})
        for p in active28
    ]
    out["areas_per_active_person_28d"] = {
        "mean": round(statistics.mean(areas), 2) if areas else None,
        "median": _median([float(a) for a in areas]),
    }
    area_people: dict[str, int] = defaultdict(int)
    for p in active28:
        for ar in {ar for d, a in p.days.items() if since <= d < today for ar in a}:
            area_people[ar] += 1
    out["people_per_area_28d"] = dict(sorted(area_people.items()))

    # Return after lapse.
    episodes = [(p, lp) for p in ppl for lp in lapses(list(p.days), today)]
    judged_eps = [r for _, (_, r) in episodes if r is not None]
    out["lapse_return_episodes"] = _share(sum(judged_eps), len(judged_eps))
    firsts = []
    for p in ppl:
        ls = [r for _, r in lapses(list(p.days), today)]
        if ls and ls[0] is not None:
            firsts.append(ls[0])
    out["lapse_return_first_lapse_people"] = _share(sum(firsts), len(firsts))

    # Time to first log.
    ttfl = [
        (p.first_log_at - p.created_at).total_seconds() / 3600
        for p in ppl
        if p.first_log_at is not None
    ]
    out["time_to_first_log_hours"] = {
        "median": _median(ttfl),
        "within_24h": _share(sum(h <= 24 for h in ttfl), len(ppl)),
    }

    # Fern and AI cost over the last 28 days, per 28-day active logger.
    a28 = {p.id for p in active28}
    turns = sum(fern.values())
    cost = sum(c for _, c in ai.values())
    out["fern_28d"] = {
        "turns": turns,
        "people_chatting": len(fern),
        "turns_per_active_logger": round(turns / len(a28), 2) if a28 else None,
        "ai_calls": sum(n for n, _ in ai.values()),
        "ai_cost_php": round(cost / 100, 2),
        "ai_cost_php_per_active_logger": round(cost / 100 / len(a28), 2)
        if a28
        else None,
    }

    # Referral source: signups and how many are weekly active loggers in the
    # last complete week.
    lws = this_week - timedelta(weeks=1)
    lwe = lws + timedelta(days=6)
    ref: dict[str, dict[str, int]] = defaultdict(lambda: {"signups": 0, "wal": 0})
    for p in ppl:
        src = p.referral or "unanswered"
        ref[src]["signups"] += 1
        ref[src]["wal"] += sum(lws <= d <= lwe for d in p.days) >= 3
    out["referral"] = dict(sorted(ref.items()))

    # App opens, time in app and share cards: only once usage_event exists.
    if usage is None:
        out["usage"] = "usage_event table not present"
    else:
        out["usage"] = usage_summary(usage, today)
    return out


def usage_summary(
    rows: list[tuple[uuid.UUID, str, datetime, str | None]], today: date
) -> dict[str, Any]:
    """Opens and closes pair into sessions per person; a close with no open
    is ignored, an open with no close counts as a session of unknown length."""
    since = datetime.combine(
        today - timedelta(days=28), datetime.min.time(), timezone.utc
    )
    per: dict[uuid.UUID, list[tuple[datetime, str]]] = defaultdict(list)
    shares: dict[str, int] = defaultdict(int)
    for owner, kind, at, detail in rows:
        if at < since:
            continue
        if kind == "share_card":
            shares[detail or "unknown"] += 1
        else:
            per[owner].append((at, kind))
    sessions = 0
    seconds: list[float] = []
    for evs in per.values():
        evs.sort()
        open_at: datetime | None = None
        last_close: datetime | None = None
        for at, kind in evs:
            if kind == "app_open":
                if last_close is None or at - last_close > SESSION_GAP:
                    sessions += 1
                    open_at = at
                elif open_at is None:
                    open_at = at
            elif kind == "app_close" and open_at is not None:
                seconds.append((at - open_at).total_seconds())
                last_close = at
                open_at = None
    return {
        "people_opening_28d": len(per),
        "sessions_28d": sessions,
        "median_session_minutes": _median([s / 60 for s in seconds]),
        "share_cards_28d": sum(shares.values()),
        "share_cards_by_card": dict(sorted(shares.items())),
    }


def load(conn: Connection, today: date, include_superusers: bool) -> dict[str, Any]:
    conn.execute(text("SET TRANSACTION READ ONLY"))
    people: dict[uuid.UUID, Person] = {}
    skipped = 0
    for r in conn.execute(text(USERS_SQL)):
        if r.is_superuser and not include_superusers:
            skipped += 1
            continue
        people[r.id] = Person(
            id=r.id,
            created_at=r.created_at,
            tz=r.tz,
            referral=r.referral_source,
            onboarded=r.onboarded,
            signup_day=r.created_at.astimezone(ZoneInfo(r.tz)).date(),
        )
    for r in conn.execute(text(LOGS_SQL)):
        p = people.get(r.owner_id)
        if p is None:
            continue
        p.days.setdefault(r.day, {})[r.area] = int(r.n)
        if p.first_log_at is None or r.first_at < p.first_log_at:
            p.first_log_at = r.first_at
    since = datetime.combine(
        today - timedelta(days=28), datetime.min.time(), timezone.utc
    )
    fern = {
        r.owner_id: int(r.n)
        for r in conn.execute(text(FERN_SQL), {"since": since})
        if r.owner_id in people
    }
    ai = {
        r.owner_id: (int(r.calls), int(r.cost))
        for r in conn.execute(text(AI_SQL), {"since": since})
        if r.owner_id in people
    }
    usage = None
    if conn.execute(text("SELECT to_regclass('usage_event')")).scalar() is not None:
        usage = [
            (r.owner_id, r.kind, r.at, r.detail)
            for r in conn.execute(text(USAGE_SQL), {"since": since})
            if r.owner_id in people
        ]
    out = compute(people.values(), today, fern, ai, usage)
    out["superusers_excluded"] = skipped
    return out


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--today", type=date.fromisoformat, default=None)
    parser.add_argument("--include-superusers", action="store_true")
    args = parser.parse_args()
    from app.core.db import engine

    today = args.today or datetime.now(timezone.utc).date()
    with engine.connect() as conn:
        with conn.begin():
            report = load(conn, today, args.include_superusers)
    sys.stdout.write("KPI " + json.dumps(report, default=str) + "\n")


if __name__ == "__main__":
    main()
