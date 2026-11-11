"""Reads the retention jobs make over one person's records.

A "log" is a record the person made (docs/25-retention-kpis.md "Terms"),
the same set ``scripts/retention_report.py`` counts: habit ticks (not the
ones screen time wrote), routine runs, tasks made or done, workouts, runs,
weigh-ins, meals, money they recorded (not the recurring job's or a balance
adjustment), focus sessions and journal entries. An engagement moment is a
log or an app open.

Every query is filtered by owner: the jobs run on the owner engine, outside
any request's tenant scope.
"""

import uuid
from datetime import datetime

from sqlalchemy import text
from sqlmodel import Session

# (table, timestamp column, area, extra condition)
_SOURCES = (
    ("habit_log", "created_at", "habits", "source <> 'screen'"),
    ("routine_run", "created_at", "habits", None),
    ("task", "created_at", "tasks", None),
    ("task", "completed_at", "tasks", "completed_at IS NOT NULL"),
    ("workout", "created_at", "fitness", None),
    ("run_session", "created_at", "fitness", None),
    ("weigh_in", "created_at", "fitness", None),
    ("meal", "created_at", "nutrition", None),
    ("fin_record", "created_at", "finance", "source NOT IN ('planned', 'adjustment')"),
    ("focus_session", "created_at", "focus", None),
    ("journal_entry", "created_at", "journal", None),
)


def _union(since: bool) -> str:
    parts = []
    for table, col, area, cond in _SOURCES:
        where = ["owner_id = :owner"]
        if cond:
            where.append(cond)
        if since:
            where.append(f"{col} >= :since")
        parts.append(
            f"SELECT {col} AS at, '{area}' AS area FROM {table} WHERE {' AND '.join(where)}"
        )
    return " UNION ALL ".join(parts)


def log_moments(
    session: Session, owner: uuid.UUID, since: datetime | None = None
) -> list[tuple[datetime, str]]:
    """Every log's moment and area, oldest first (from ``since`` if given)."""
    sql = f"SELECT at, area FROM ({_union(since is not None)}) l ORDER BY at"
    params: dict[str, object] = {"owner": owner}
    if since is not None:
        params["since"] = since
    return [(r.at, r.area) for r in session.execute(text(sql), params)]


def latest_log_at(session: Session, owner: uuid.UUID) -> datetime | None:
    sql = f"SELECT max(at) FROM ({_union(False)}) l"
    value = session.execute(text(sql), {"owner": owner}).scalar()
    return value if isinstance(value, datetime) else None


def app_opens(session: Session, owner: uuid.UUID, since: datetime) -> list[datetime]:
    rows = session.execute(
        text(
            "SELECT at FROM usage_event WHERE owner_id = :owner"
            " AND kind = 'app_open' AND at >= :since ORDER BY at"
        ),
        {"owner": owner, "since": since},
    )
    return [r.at for r in rows]
