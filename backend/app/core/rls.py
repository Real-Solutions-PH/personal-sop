import logging

from sqlalchemy import Engine, text

from app.core.config import settings
from app.core.db import app_engine

logger = logging.getLogger(__name__)


def _connection_bypasses_rls(engine: Engine) -> tuple[bool, str | None]:
    """Whether ``engine``'s role bypasses row-level security, and which role.

    Table OWNERS bypass plain ``ENABLE RLS`` just like superusers/BYPASSRLS —
    on managed Postgres the app role is often a non-superuser schema owner, so
    checking ``rolsuper``/``rolbypassrls`` alone gives a false all-clear.
    """
    with engine.connect() as conn:
        bypasses = conn.execute(
            text(
                "SELECT (SELECT rolbypassrls OR rolsuper FROM pg_roles"
                "        WHERE rolname = current_user)"
                " OR EXISTS (SELECT 1 FROM pg_tables"
                "            WHERE schemaname = 'public'"
                "            AND tablename = 'item'"
                "            AND pg_catalog.pg_has_role("
                "                current_user, tableowner, 'MEMBER'))"
            )
        ).scalar()
        role = conn.execute(text("SELECT current_user")).scalar()
    return bool(bypasses), role


def check_rls_posture() -> None:
    """Report whether the app engine actually enforces row-level security.

    - Enforced (non-owner role): silent — the second wall is live.
    - Bypassing in local: a warning; the owner engine is the dev default.
    - Bypassing outside local *with* ``POSTGRES_APP_USER`` configured: fatal.
      Opting into the app_user role but still bypassing means tenant isolation
      is silently off — refuse to boot rather than run unprotected.
    """
    try:
        bypasses, role = _connection_bypasses_rls(app_engine)
    except Exception:  # pragma: no cover - visibility only, never fatal here
        logger.warning("Could not determine RLS posture of the app connection")
        return

    if not bypasses:
        return

    message = (
        f"app engine runs as {role} which bypasses row security via"
        " superuser/BYPASSRLS or table ownership"
    )
    if settings.ENVIRONMENT != "local" and settings.app_user_configured:
        raise RuntimeError(
            f"RLS misconfigured: {message} despite POSTGRES_APP_USER being set"
        )
    logger.warning(
        "RLS is DORMANT: %s (expected until the app engine connects as app_user)",
        message,
    )
