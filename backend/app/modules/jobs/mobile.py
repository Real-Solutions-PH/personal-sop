"""Scheduled work for the mobile API (registered in ``jobs.tasks``).

Each runner opens its own owner-engine session (a detached job has no
request), builds one ``Ctx`` per user and calls that module's job body. Every
body is idempotent — reminders and digests dedupe on the inbox key, auto-log on
the derived settle id — so an overlapping or retried run is harmless.
"""

from datetime import datetime, timezone

from sqlmodel import Session, col, select

from app.core.db import engine
from app.logger import app_logger
from app.modules.finance.models import PlannedItem
from app.modules.iam.users.models import User
from app.shared.context import make_ctx


def run_task_reminders(now: datetime | None = None) -> int:
    from app.modules.tasks.jobs import run_reminders

    with Session(engine) as session:
        return run_reminders(session, now=now or datetime.now(timezone.utc))


def run_task_digests(now: datetime | None = None) -> int:
    from app.modules.tasks.jobs import run_digests

    with Session(engine) as session:
        return run_digests(session, now=now or datetime.now(timezone.utc))


def run_finance_auto_log(now: datetime | None = None) -> int:
    from app.modules.finance.services import auto_log_due

    at = now or datetime.now(timezone.utc)
    logged = 0
    with Session(engine) as session:
        owners = session.exec(
            select(PlannedItem.owner_id)
            .where(
                col(PlannedItem.auto_log).is_(True),
                col(PlannedItem.archived).is_(False),
                col(PlannedItem.deleted_at).is_(None),
            )
            .distinct()
        ).all()
        users = session.exec(select(User).where(col(User.id).in_(list(owners)))).all()
        for user in users:
            try:
                logged += len(auto_log_due(make_ctx(session, user, now=at)))
            except Exception:  # one user's bad data must not stop the rest
                session.rollback()
                app_logger.exception("finance auto-log failed for one user")
    return logged
