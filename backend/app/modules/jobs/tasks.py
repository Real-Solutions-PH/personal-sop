from app.logger import app_logger
from app.modules.jobs.app import jobs_app


@jobs_app.task(name="jobs.example")
def example_task(message: str = "ping") -> str:
    """Minimal demonstration task: logs its payload from the worker.

    Exists to prove the enqueue-from-route to execute-in-worker path end to
    end; real modules register their own tasks the same way.
    """
    app_logger.info("jobs.example executed with message=%s", message)
    return message


# --- Mobile API schedules (bodies in app.modules.jobs.mobile) --------------


@jobs_app.periodic(cron="* * * * *")
@jobs_app.task(name="mobile.tasks.reminders", queueing_lock="mobile.tasks.reminders")
def task_reminders(timestamp: int) -> int:
    from app.modules.jobs.mobile import run_task_reminders

    del timestamp
    return run_task_reminders()


@jobs_app.periodic(cron="*/5 * * * *")
@jobs_app.task(name="mobile.tasks.digests", queueing_lock="mobile.tasks.digests")
def task_digests(timestamp: int) -> int:
    from app.modules.jobs.mobile import run_task_digests

    del timestamp
    return run_task_digests()


@jobs_app.periodic(cron="*/15 * * * *")
@jobs_app.task(name="mobile.finance.auto_log", queueing_lock="mobile.finance.auto_log")
def finance_auto_log(timestamp: int) -> int:
    from app.modules.jobs.mobile import run_finance_auto_log

    del timestamp
    return run_finance_auto_log()


@jobs_app.periodic(cron="17 * * * *")
@jobs_app.task(
    name="mobile.capture.maintenance", queueing_lock="mobile.capture.maintenance"
)
def capture_maintenance(timestamp: int) -> dict[str, int]:
    from app.modules.jobs.mobile import run_capture_maintenance

    del timestamp
    return run_capture_maintenance()


@jobs_app.periodic(cron="7 * * * *")
@jobs_app.task(
    name="mobile.retention.nightly", queueing_lock="mobile.retention.nightly"
)
def retention_nightly(timestamp: int) -> int:
    """Each person's retention profile, in their local 03:00 hour."""
    from app.modules.jobs.mobile import run_retention_nightly

    del timestamp
    return run_retention_nightly()


@jobs_app.periodic(cron="*/5 * * * *")
@jobs_app.task(name="mobile.retention.nudges", queueing_lock="mobile.retention.nudges")
def retention_nudges(timestamp: int) -> int:
    """At most one engagement nudge per person per day, at their usual time."""
    from app.modules.jobs.mobile import run_retention_nudges

    del timestamp
    return run_retention_nudges()


# --- Fern's server-side queue (bodies in app.modules.companion.queue) ------


@jobs_app.task(name="companion.drain")
def companion_drain(owner_id: str) -> int:
    """Backstop drain for one person's Fern messages, deferred a minute after
    each is queued (the API task's own drain normally answers first)."""
    import uuid

    from app.modules.companion.queue import drain

    return drain(uuid.UUID(owner_id))


@jobs_app.periodic(cron="* * * * *")
@jobs_app.task(name="companion.sweep", queueing_lock="companion.sweep")
def companion_sweep(timestamp: int) -> int:
    """Restart any Fern queue a dead task left: a message waiting with
    nothing running, or a turn whose lease lapsed."""
    from app.modules.companion.queue import sweep

    del timestamp
    return sweep()
