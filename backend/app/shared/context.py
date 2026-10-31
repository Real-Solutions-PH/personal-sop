"""Per-request domain context: who is acting, on which session, on what day.

Every domain service takes one keyword-only ``ctx: Ctx`` instead of a loose
``session`` + ``current_user`` pair, so the business day (time zone + day start
hour from the user's profile) is resolved once per request and every write
stamps the same ``now``.

Transaction convention: a service function is one use case and ends with
``ctx.commit()``; repositories only flush. Cross-module calls made from inside
another use case (``public.py`` functions) never commit — the caller does.
"""

import uuid
from collections.abc import Callable, Hashable
from dataclasses import dataclass, field
from datetime import date, datetime
from typing import Annotated, Any, TypeVar

from fastapi import Depends
from sqlmodel import Session, select

from app.modules.iam.deps import CurrentUser, release_connection
from app.modules.iam.users.models import User
from app.shared.currency import PHP, Currency, currency
from app.shared.day import DayClock
from app.shared.owned import utcnow
from app.shared.tenant_session import TenantScopedSessionDep

T = TypeVar("T")


@dataclass
class Ctx:
    session: Session
    user: User
    clock: DayClock = field(default_factory=DayClock)
    # The profile's currency: every money text and AI prompt names it.
    currency: Currency = PHP
    now: datetime = field(default_factory=utcnow)
    # Set by the sync engine while it applies a pushed batch: use cases then
    # flush instead of committing, and the engine commits each op itself
    # (inside a SAVEPOINT) so one rejected op does not roll back the others.
    in_batch: bool = False
    # Whole-history snapshots a read loads once and shares (``None`` = off).
    # A stats read asks every module for the user's full state once per
    # figure; without this one overview re-read the same history dozens of
    # times. Only read-only requests turn it on (``ReadCtxDep``), and a
    # commit drops what was kept.
    snapshots: dict[Hashable, Any] | None = None

    @property
    def user_id(self) -> uuid.UUID:
        return self.user.id

    @property
    def tenant_id(self) -> uuid.UUID:
        return self.user.tenant_id

    @property
    def today(self) -> date:
        return self.clock.day_of(self.now)

    def commit(self) -> None:
        """End of a use case: commit (or just flush inside a sync batch)."""
        if self.in_batch:
            self.session.flush()
        else:
            self.session.commit()
        if self.snapshots:
            self.snapshots.clear()

    def snapshot(self, key: Hashable, load: Callable[[], T]) -> T:
        """``load()``, kept for the rest of the request when snapshots are on.

        Callers treat the result as read-only: later readers get the same
        object."""
        if self.snapshots is None:
            return load()
        if key not in self.snapshots:
            self.snapshots[key] = load()
        kept: T = self.snapshots[key]
        return kept

    def owned(self) -> dict[str, uuid.UUID]:
        """The ownership columns for a new row."""
        return {"owner_id": self.user.id, "tenant_id": self.user.tenant_id}


def prefs_for(session: Session, user_id: uuid.UUID) -> tuple[DayClock, Currency]:
    """The day clock and currency from the user's profile (defaults without one)."""
    # Imported here: profile models import nothing from this module, but the
    # context is imported by every module's routes.
    from app.modules.profile.models import UserProfile

    row = session.exec(
        select(
            UserProfile.timezone, UserProfile.day_start_hour, UserProfile.currency
        ).where(UserProfile.owner_id == user_id)
    ).first()
    if row is None:
        return DayClock(), PHP
    return DayClock(timezone=row[0], start_hour=row[1]), currency(row[2])


def clock_for(session: Session, user_id: uuid.UUID) -> DayClock:
    return prefs_for(session, user_id)[0]


def make_ctx(session: Session, user: User, now: datetime | None = None) -> Ctx:
    clock, cur = prefs_for(session, user.id)
    return Ctx(
        session=session, user=user, clock=clock, currency=cur, now=now or utcnow()
    )


def get_ctx(session: TenantScopedSessionDep, current_user: CurrentUser) -> Ctx:
    ctx = make_ctx(session, current_user)
    # FastAPI runs each sync dependency and the endpoint on separate
    # threadpool hops. Holding the clock-lookup connection across that hop
    # deadlocks under load: every thread waits for a connection while every
    # connection waits for a thread. The endpoint checks out its own.
    release_connection(session)
    return ctx


CtxDep = Annotated[Ctx, Depends(get_ctx)]


async def get_read_ctx(ctx: CtxDep) -> Ctx:
    """The context of a read-only request, with snapshots on.

    ``async`` on purpose: it does no I/O, so it costs no threadpool hop."""
    ctx.snapshots = {}
    return ctx


ReadCtxDep = Annotated[Ctx, Depends(get_read_ctx)]
