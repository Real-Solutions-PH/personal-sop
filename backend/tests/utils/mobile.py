"""Fixtures shared by the mobile-API module tests.

``signed_in`` gives a real GoTrue user plus bearer headers (integration
tests). ``ctx_for`` builds a domain :class:`Ctx` on a plain owner session for
service-level tests that do not go through HTTP.
"""

from collections.abc import Generator
from contextlib import contextmanager
from datetime import datetime

from sqlmodel import Session

from app.core.db import engine
from app.modules.iam.users.models import User
from app.shared.context import Ctx, make_ctx
from tests.utils.user import create_auth_user
from tests.utils.utils import auth_headers


def signed_in(db: Session) -> tuple[User, dict[str, str]]:
    user, password = create_auth_user(db)
    return user, auth_headers(user.email, password)


@contextmanager
def ctx_for(user: User, now: datetime | None = None) -> Generator[Ctx, None, None]:
    with Session(engine) as session:
        bound = session.merge(user)
        yield make_ctx(session, bound, now=now)
