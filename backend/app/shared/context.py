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
from dataclasses import dataclass, field
from datetime import date, datetime
from typing import Annotated

from fastapi import Depends
from sqlmodel import Session, select

from app.modules.iam.deps import CurrentUser
from app.modules.iam.users.models import User
from app.shared.day import DayClock
from app.shared.owned import utcnow
from app.shared.tenant_session import TenantScopedSessionDep


@dataclass
class Ctx:
    session: Session
    user: User
    clock: DayClock = field(default_factory=DayClock)
    now: datetime = field(default_factory=utcnow)
    # Set by the sync engine while it applies a pushed batch: use cases then
    # flush instead of committing, and the engine commits each op itself
    # (inside a SAVEPOINT) so one rejected op does not roll back the others.
    in_batch: bool = False

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

    def owned(self) -> dict[str, uuid.UUID]:
        """The ownership columns for a new row."""
        return {"owner_id": self.user.id, "tenant_id": self.user.tenant_id}


def clock_for(session: Session, user_id: uuid.UUID) -> DayClock:
    # Imported here: profile models import nothing from this module, but the
    # context is imported by every module's routes.
    from app.modules.profile.models import UserProfile

    row = session.exec(
        select(UserProfile.timezone, UserProfile.day_start_hour).where(
            UserProfile.owner_id == user_id
        )
    ).first()
    if row is None:
        return DayClock()
    return DayClock(timezone=row[0], start_hour=row[1])


def make_ctx(session: Session, user: User, now: datetime | None = None) -> Ctx:
    return Ctx(
        session=session,
        user=user,
        clock=clock_for(session, user.id),
        now=now or utcnow(),
    )


def get_ctx(session: TenantScopedSessionDep, current_user: CurrentUser) -> Ctx:
    return make_ctx(session, current_user)


CtxDep = Annotated[Ctx, Depends(get_ctx)]
