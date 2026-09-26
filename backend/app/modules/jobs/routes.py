from typing import Any

from fastapi import APIRouter, Depends, status

from app.modules.iam.deps import get_current_user
from app.modules.jobs.tasks import example_task

router = APIRouter(prefix="/jobs", tags=["jobs"])


@router.post(
    "/example",
    status_code=status.HTTP_202_ACCEPTED,
    dependencies=[Depends(get_current_user)],
)
async def enqueue_example_job() -> dict[str, Any]:
    """Enqueue the demonstration task for the worker to execute.

    Returns the queued job's id; the task itself runs in the worker process,
    not in this request.
    """
    job_id = await example_task.defer_async(message="ping")
    return {"job_id": job_id}
