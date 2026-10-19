"""Procrastinate tasks of the stats module.

``stats.recompute_day`` is deferred by the dirty drain with a per-(user, day)
queueing lock and a delay, so a burst of writes on one day runs one recompute
(the debounce). ``stats.seal`` runs hourly and seals each user's yesterday once
their day has rolled over.
"""

import uuid
from datetime import date

from app.modules.jobs.app import jobs_app


@jobs_app.task(name="stats.recompute_day")
def recompute_day_task(owner_id: str, day: str) -> int:
    from app.modules.stats.rollups import recompute_for

    return recompute_for(uuid.UUID(owner_id), [date.fromisoformat(day)])


@jobs_app.periodic(cron="5 * * * *")
@jobs_app.task(name="stats.seal", queueing_lock="stats.seal")
def seal_task(timestamp: int) -> int:
    from app.modules.stats.rollups import seal_all

    del timestamp
    return seal_all()
