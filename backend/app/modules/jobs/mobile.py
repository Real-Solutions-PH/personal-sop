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


def _each_user_with(model: type, session: Session) -> list[User]:
    owners = session.exec(select(model.owner_id).distinct()).all()  # type: ignore[attr-defined]
    return list(session.exec(select(User).where(col(User.id).in_(list(owners)))).all())


def run_capture_maintenance(now: datetime | None = None) -> dict[str, int]:
    """Retention (captures past ``retention_days`` are tombstoned) and the
    recovery of captures stuck in ``processing`` after a crash."""
    from app.modules.capture import engine as capture_engine
    from app.modules.capture.models import Capture

    at = now or datetime.now(timezone.utc)
    out = {"purged": 0, "resumed": 0}
    with Session(engine) as session:
        for user in _each_user_with(Capture, session):
            try:
                ctx = make_ctx(session, user, now=at)
                out["purged"] += capture_engine.purge_expired(ctx)
                out["resumed"] += capture_engine.resume_stuck(ctx)
                session.commit()  # resume_stuck leaves the commit to its caller
            except Exception:  # one user's bad data must not stop the rest
                session.rollback()
                app_logger.exception("capture maintenance failed for one user")
    return out
