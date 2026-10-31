"""More requests in flight than threadpool threads deadlocked the pool.

A sync route's endpoint returns while its session still holds a pooled
connection, then waits for a thread to serialise the response. When every
thread was taken by a request waiting for a connection, the holders never got
one, and every request failed at the pool timeout. The app here shrinks the
real shape (a session dependency, a sync endpoint, a response model) to one
connection and two threads so the cycle closes in a few requests."""

from collections.abc import AsyncIterator, Iterator
from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager
from typing import Annotated

import anyio.to_thread
import pytest
from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient
from pydantic import BaseModel
from sqlalchemy import create_engine, text
from sqlmodel import Session

from app.core.config import settings
from app.main import InFlightLimitMiddleware

THREADS = 2
REQUESTS = 8


class One(BaseModel):
    n: int


def _app(*, limited: bool) -> FastAPI:
    engine = create_engine(
        str(settings.SQLALCHEMY_DATABASE_URI),
        pool_size=1,
        max_overflow=0,
        pool_timeout=2,
    )

    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncIterator[None]:
        anyio.to_thread.current_default_thread_limiter().total_tokens = THREADS
        yield
        engine.dispose()

    app = FastAPI(lifespan=lifespan)
    if limited:
        app.add_middleware(InFlightLimitMiddleware)

    def session() -> Iterator[Session]:
        with Session(engine) as s:
            yield s

    @app.get("/one", response_model=One)
    def one(s: Annotated[Session, Depends(session)]) -> One:
        return One(n=s.execute(text("SELECT 1")).scalar_one())

    return app


def _burst(app: FastAPI) -> list[int]:
    with TestClient(app, raise_server_exceptions=False) as client:
        with ThreadPoolExecutor(REQUESTS) as pool:
            return list(
                pool.map(lambda _: client.get("/one").status_code, range(REQUESTS))
            )


def test_without_the_limit_the_pool_deadlocks() -> None:
    """The shape below does reproduce the failure, so the next test's green
    means the limit, not a scenario too small to deadlock."""
    assert 500 in _burst(_app(limited=False))


def test_the_limit_keeps_a_thread_for_the_connection_holder(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "MAX_IN_FLIGHT_REQUESTS", THREADS - 1)
    assert _burst(_app(limited=True)) == [200] * REQUESTS
