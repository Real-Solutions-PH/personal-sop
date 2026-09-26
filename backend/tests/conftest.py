import secrets
from collections.abc import Generator

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Engine, create_engine, text
from sqlmodel import Session, delete

from app.core.config import settings
from app.core.db import engine, init_db
from app.db.models import Item, User
from app.main import app
from tests.utils.user import authentication_token_from_email
from tests.utils.utils import get_superuser_token_headers

# One credential for the whole session: the app engine (when POSTGRES_APP_USER
# is set) and the direct-SQL RLS tests all dial app_user with this password. Use
# the configured one so the app engine — built from settings at import — can
# actually connect; otherwise a throwaway (the role only needs SOME login here).
_APP_USER_PASSWORD = settings.POSTGRES_APP_PASSWORD or secrets.token_urlsafe(24)


@pytest.fixture(scope="session", autouse=True)
def db() -> Generator[Session, None, None]:
    # init_db needs the local Supabase stack running (make supabase-up):
    # the FIRST_SUPERUSER bootstrap goes through the GoTrue admin API.
    with Session(engine) as session:
        init_db(session)
        yield session
        # Local rows only — GoTrue users persist across runs, which is why
        # every fixture-side create is idempotent.
        statement = delete(Item)
        session.execute(statement)
        statement = delete(User)
        session.execute(statement)
        session.commit()


@pytest.fixture(scope="session", autouse=True)
def app_user_engine() -> Generator[Engine, None, None]:
    """Provision the non-owner ``app_user`` role's LOGIN for the whole session.

    The role itself is created by the migrations (run before pytest); this only
    flips it to LOGIN. ``autouse`` because in the RLS-enforced config the app
    engine connects as app_user on any tenant route, so the login must exist
    before the first request — not only when a test asks for this fixture.
    Provisioning once per session (never per module) is deliberate: a mid-run
    reprovision would change the password out from under the app engine's live
    connections.

    Yields an engine connected as app_user for the direct-SQL RLS tests. Single
    pooled connection so the ''-vs-NULL claim gotcha (a claim-less transaction
    reusing a connection a prior ``set_config`` touched) still reproduces.
    Teardown clears the login — NOLOGIN alone leaves the password, and the DB
    this points at may be a real local one.
    """
    # ALTER ROLE ... PASSWORD is DDL: the password is a string literal, not a
    # bind parameter. Escape single quotes so a configured password can't break
    # out of the literal (the fallback token is already quote-free).
    pw_literal = _APP_USER_PASSWORD.replace("'", "''")
    with engine.connect() as conn:
        conn.execute(text(f"ALTER ROLE app_user LOGIN PASSWORD '{pw_literal}'"))
        conn.commit()
    app_user_url = (
        f"postgresql+psycopg://app_user:{_APP_USER_PASSWORD}"
        f"@{settings.POSTGRES_SERVER}:{settings.POSTGRES_PORT}/{settings.POSTGRES_DB}"
    )
    eng = create_engine(app_user_url, pool_size=1, max_overflow=0)
    try:
        yield eng
    finally:
        eng.dispose()
        with engine.connect() as conn:
            conn.execute(text("ALTER ROLE app_user NOLOGIN PASSWORD NULL"))
            conn.commit()


@pytest.fixture(scope="module")
def client() -> Generator[TestClient, None, None]:
    with TestClient(app) as c:
        yield c


@pytest.fixture(scope="module")
def superuser_token_headers() -> dict[str, str]:
    return get_superuser_token_headers()


@pytest.fixture(scope="module")
def normal_user_token_headers(db: Session) -> dict[str, str]:
    return authentication_token_from_email(email=settings.EMAIL_TEST_USER, db=db)
