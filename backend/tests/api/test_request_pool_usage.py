"""A request holds at most one pooled connection at a time.

Authentication runs on the request session; mobile routes then open a tenant
session. Locally both come from one pool (no separate ``app_user`` engine),
so a request that kept its auth connection while checking out a second one
deadlocked the pool under load: every request held one connection and waited
for another until the pool timeout turned them all into 500s.
"""

from collections.abc import Iterator
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import event
from sqlmodel import Session

from app.core.config import settings
from app.core.db import app_engine, engine
from app.shared.day import DayClock
from tests.utils.mobile import signed_in

API = settings.API_V1_STR


@pytest.fixture
def pool_usage() -> Iterator[dict[str, int]]:
    """Highest number of connections checked out at once, across both engines
    (one pool when they are the same engine)."""
    # Listen on the engines, not ``engine.pool``: a dispose swaps the pool.
    pools = {id(e): e for e in (engine, app_engine)}
    state = {"now": 0, "peak": 0}

    def out(*_: Any) -> None:
        state["now"] += 1
        state["peak"] = max(state["peak"], state["now"])

    def back(*_: Any) -> None:
        state["now"] -= 1

    for pool in pools.values():
        event.listen(pool, "checkout", out)
        event.listen(pool, "checkin", back)
    try:
        yield state
    finally:
        for pool in pools.values():
            event.remove(pool, "checkout", out)
            event.remove(pool, "checkin", back)


def test_a_tenant_scoped_route_never_holds_two_connections(
    client: TestClient, db: Session, pool_usage: dict[str, int]
) -> None:
    _, headers = signed_in(db)
    # The test's own ``db`` session gives its connection back here; count
    # what the request checks out from zero.
    db.commit()
    pool_usage.update(now=0, peak=0)
    r = client.get(f"{API}/profile", headers=headers)
    assert r.status_code == 200, r.text
    assert pool_usage["peak"] == 1


def test_a_write_recomputing_stats_never_holds_two_connections(
    client: TestClient,
    db: Session,
    pool_usage: dict[str, int],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Inline recompute (no job queue), as in local development. It runs from
    # the after-commit hook; it must start only once the writer's connection
    # is back in the pool.
    from app.modules.stats import rollups

    monkeypatch.setattr(settings, "JOBS_ENABLED", False)
    ran: list[int] = []
    real = rollups.recompute_for

    def spy(owner: Any, days: Any) -> int:
        ran.append(1)
        return real(owner, days)

    monkeypatch.setattr(rollups, "recompute_for", spy)
    _, headers = signed_in(db)
    db.commit()
    pool_usage.update(now=0, peak=0)
    r = client.post(
        f"{API}/tasks/",
        headers=headers,
        json={"title": "Pool check", "due_date": DayClock().today().isoformat()},
    )
    assert r.status_code in (200, 201), r.text
    assert ran, "the write never triggered a stats recompute"
    assert pool_usage["peak"] == 1


def test_the_ctx_dependency_hands_its_connection_back(
    db: Session, pool_usage: dict[str, int]
) -> None:
    # Dependencies and the endpoint run on different threadpool hops; a
    # connection kept across a hop is one a waiting thread cannot get, and
    # under load every thread ends up waiting while every connection waits
    # for a thread.
    from app.modules.iam.users.models import User
    from app.shared.context import get_ctx

    user, _ = signed_in(db)
    uid = user.id
    with Session(engine) as s:
        detached = s.get(User, uid)
        assert detached is not None
        s.expunge(detached)
    db.commit()
    pool_usage.update(now=0, peak=0)
    with Session(app_engine) as tenant:
        ctx = get_ctx(tenant, detached)
        assert pool_usage["peak"] == 1  # the clock lookup did run
        assert pool_usage["now"] == 0
        assert ctx.today  # the clock it read survives the release
