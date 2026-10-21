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
