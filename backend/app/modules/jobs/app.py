import procrastinate

from app.core.config import settings


def create_jobs_app() -> procrastinate.App:
    """Build the Procrastinate app backed by the owner Postgres connection.

    Procrastinate owns its ``procrastinate_*`` tables, which are queue
    infrastructure rather than tenant data, so it connects with the owner
    credentials (not the RLS-enforced app role). The connector opens its pool
    lazily, so importing this module never touches the database — the API
    process opens it in the app lifespan and the worker CLI opens it itself.
    """
    connector = procrastinate.PsycopgConnector(
        # `kwargs` are the libpq connection params for the pool's connections;
        # passing them at the top level would (wrongly) go to the pool itself.
        kwargs={
            "host": settings.POSTGRES_SERVER,
            "port": settings.POSTGRES_PORT,
            "user": settings.POSTGRES_USER,
            "password": settings.POSTGRES_PASSWORD,
            "dbname": settings.POSTGRES_DB,
        }
    )
    return procrastinate.App(
        connector=connector,
        import_paths=["app.modules.jobs.tasks"],
    )


jobs_app = create_jobs_app()
