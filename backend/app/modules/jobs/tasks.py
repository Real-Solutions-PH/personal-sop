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
