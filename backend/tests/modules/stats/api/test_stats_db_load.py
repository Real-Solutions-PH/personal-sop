"""A stats read loads each module's whole history once, not once per figure.

Every contributor (Life Score rate, today's ring, facets, metrics) asked its
module for the user's full state, so one ``/stats/overview`` re-read every
workout set, habit log, task and ledger record many times over. The app asks
for four ranges, misses and the calendar on open; on the production API's
quarter of a vCPU that work held the database connections long enough that
every other request timed out waiting for one."""

import re
from collections import Counter
from collections.abc import Iterator
from contextlib import contextmanager
from typing import Any

from fastapi.testclient import TestClient
from sqlalchemy import Engine, event
from sqlmodel import Session

from app.core.config import settings
from app.core.db import app_engine, engine
from tests.utils.mobile import signed_in

API = f"{settings.API_V1_STR}/stats"

# The table each module's whole-history load reads, and how many distinct
# snapshot shapes a stats request may ask for (fitness loads with and without
# meals).
HISTORY = {"workout_set": 2, "habit_log": 1, "task": 1, "fin_record": 1}

_FROM = re.compile(r"\bFROM\s+(\w+)", re.IGNORECASE)
_WRITE = re.compile(r"^\s*(INSERT|UPDATE|DELETE)\b", re.IGNORECASE)


@contextmanager
def statements() -> Iterator[list[str]]:
    """Every statement either engine runs while the block is open."""
    seen: list[str] = []

    def record(_conn: Any, _cursor: Any, statement: str, *_: Any) -> None:
        seen.append(statement)

    engines: set[Engine] = {engine, app_engine}
    for e in engines:
        event.listen(e, "before_cursor_execute", record)
    try:
        yield seen
    finally:
        for e in engines:
            event.remove(e, "before_cursor_execute", record)


def selects_by_table(seen: list[str]) -> Counter[str]:
    out: Counter[str] = Counter()
    for statement in seen:
        m = _FROM.search(statement)
        if statement.lstrip().upper().startswith("SELECT") and m:
            out[m.group(1).lower()] += 1
    return out


def test_overview_reads_each_history_once(client: TestClient, db: Session) -> None:
    _, h = signed_in(db)
    # Warm the request once so first-touch rows (profile, settings) are made.
    assert client.get(f"{API}/overview", headers=h).status_code == 200

    with statements() as seen:
        r = client.get(f"{API}/overview", headers=h, params={"range": "30d"})

    assert r.status_code == 200, r.text
    by_table = selects_by_table(seen)
    assert {t: by_table[t] for t in HISTORY} == HISTORY


def test_a_statistic_writes_nothing(client: TestClient, db: Session) -> None:
    """Someone who never opened Finance has no finance settings, and before
    onboarding no profile. A read that created them (and the default
    categories) every time, only to roll them back, held those row locks for
    the whole request: the same user's other requests waited in the database
    on them, each holding a pooled connection, until the pool ran out."""
    _, h = signed_in(db)

    with statements() as seen:
        for path in ("overview", "today", "achievements", "misses", "calendar"):
            r = client.get(f"{API}/{path}", headers=h)
            assert r.status_code == 200, (path, r.text)
        r = client.get(f"{settings.API_V1_STR}/dashboard/today", headers=h)
        assert r.status_code == 200, r.text

    assert [s for s in seen if _WRITE.match(s)] == []
