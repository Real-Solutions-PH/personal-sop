"""Background-jobs slice: the demo task, the enqueue route, and the flag gate.

The route-to-worker execution is proven end to end against a real worker
container in the compose stack; here we cover the units without one, using
Procrastinate's in-memory connector.
"""

import asyncio
from collections.abc import Generator

import pytest
from fastapi import FastAPI, status
from fastapi.testclient import TestClient
from procrastinate import testing
from procrastinate.jobs import Status

from app.core.config import Settings, settings
from app.modules.iam.deps import get_current_user
from app.modules.jobs.app import jobs_app
from app.modules.jobs.main import router as jobs_router
from app.modules.jobs.tasks import example_task
from app.shared.errors import register_exception_handlers

JOBS = f"{settings.API_V1_STR}/jobs"


def test_settings_jobs_flag_defaults_to_disabled_bool() -> None:
    # A fresh Settings (env may set it) still types the flag as a bool, and the
    # class default is off, matching AI_ENABLED / OCR_ENABLED.
    assert Settings.model_fields["JOBS_ENABLED"].default is False
    assert isinstance(settings.JOBS_ENABLED, bool)


def test_example_task_executes_and_returns_its_message() -> None:
    assert example_task(message="pong") == "pong"


@pytest.fixture
def jobs_client() -> Generator[
    tuple[TestClient, testing.InMemoryConnector], None, None
]:
    """A minimal app mounting only the jobs router, auth stubbed, in-memory queue."""
    connector = testing.InMemoryConnector()
    app = FastAPI()
    register_exception_handlers(app)
    app.include_router(jobs_router, prefix=settings.API_V1_STR)
    app.dependency_overrides[get_current_user] = lambda: None
    with jobs_app.replace_connector(connector):
        with TestClient(app) as client:
            yield client, connector


def test_enqueue_route_defers_the_task(
    jobs_client: tuple[TestClient, testing.InMemoryConnector],
) -> None:
    client, connector = jobs_client
    response = client.post(f"{JOBS}/example")
    assert response.status_code == status.HTTP_202_ACCEPTED
    assert "job_id" in response.json()
    assert len(connector.jobs) == 1
    (job,) = connector.jobs.values()
    assert job["task_name"] == "jobs.example"
    assert job["args"] == {"message": "ping"}


def test_enqueue_route_requires_authentication(
    jobs_client: tuple[TestClient, testing.InMemoryConnector],
) -> None:
    client, connector = jobs_client
    # Clear the auth override so the real dependency rejects the anonymous call.
    client.app.dependency_overrides.clear()  # type: ignore[attr-defined]
    response = client.post(f"{JOBS}/example")
    assert response.status_code in (
        status.HTTP_401_UNAUTHORIZED,
        status.HTTP_403_FORBIDDEN,
    )
    assert len(connector.jobs) == 0


def test_jobs_route_absent_when_module_disabled(client: TestClient) -> None:
    # JOBS_ENABLED is off in the test config, so the router is never mounted.
    assert settings.JOBS_ENABLED is False
    assert client.post(f"{JOBS}/example").status_code == status.HTTP_404_NOT_FOUND


def test_real_connector_defers_and_worker_executes() -> None:
    """Open the real Postgres-backed queue, defer, and drain the worker once.

    Covers the wiring the in-memory tests cannot: that the connector is built
    with a valid libpq configuration and that a deferred job runs to success.
    Requires the queue schema (migrations at head).
    """

    async def run() -> Status:
        async with jobs_app.open_async():
            job_id = await example_task.defer_async(message="integration")
            await jobs_app.run_worker_async(
                wait=False,
                install_signal_handlers=False,
                listen_notify=False,
            )
            return await jobs_app.job_manager.get_job_status_async(job_id)

    assert asyncio.run(run()) is Status.SUCCEEDED
