from sqlmodel import Session, create_engine

from app.core.config import settings

# Owner engine: table owner, bypasses RLS. Migrations, prestart seeding, and
# platform-operator (superuser) paths run here.
engine = create_engine(str(settings.SQLALCHEMY_DATABASE_URI))

# App engine: connects as the non-owner ``app_user`` role so RLS policies are
# enforced for tenant-scoped requests. Falls back to the owner engine when
# ``POSTGRES_APP_USER`` is unset (local/dev), leaving RLS dormant.
if settings.app_user_configured:
    app_engine = create_engine(str(settings.SQLALCHEMY_APP_DATABASE_URI))
else:
    app_engine = engine


# Ensure every module-level SQLModel is imported (via app.db.models) before
# SQLModel resolves relationships. See:
# https://github.com/fastapi/full-stack-fastapi-template/issues/28


def init_db(session: Session) -> None:
    # Imported lazily: seeders live inside modules whose deps eventually
    # re-import ``engine`` from here, which would deadlock at module load.
    from app.core import supabase_auth
    from app.modules.iam.permissions.seed import seed_permissions
    from app.modules.iam.rbac.seed import seed_role_permissions
    from app.modules.iam.roles.seed import seed_roles
    from app.modules.iam.tenants import services as tenant_service
    from app.modules.iam.tenants.seed import seed_tenants
    from app.modules.iam.users import repo as user_repo
    from app.modules.iam.users.models import User
    from app.modules.items.models import Item  # noqa: F401  resolve User.items mapper

    # Tables are managed by Alembic migrations.
    # Tenants are seeded first: users (including FIRST_SUPERUSER) need one.
    seed_roles(session)
    seed_permissions(session)
    seed_role_permissions(session)
    seed_tenants(session)

    # FIRST_SUPERUSER bootstrap: the auth identity lives in Supabase.
    # Idempotent — create-or-fetch the GoTrue user (the password is set for
    # local/CI convenience and test fixtures), then upsert the local mirror
    # row keyed by the auth UID with is_superuser=True.
    auth_uid = supabase_auth.admin_get_or_create_user(
        email=settings.FIRST_SUPERUSER,
        password=settings.FIRST_SUPERUSER_PASSWORD,
    )
    user = session.get(User, auth_uid)
    if not user:
        user_repo.create(
            session=session,
            user=User(
                id=auth_uid,
                email=settings.FIRST_SUPERUSER,
                is_superuser=True,
                is_active=True,
                tenant_id=tenant_service.get_default_tenant(session=session).id,
            ),
        )
    elif not user.is_superuser:
        user_repo.update(session=session, user=user, update_data={"is_superuser": True})

    if settings.AI_ENABLED:
        from app.modules.ai.agents.seed import seed_agents
        from app.modules.ai.tools.seed import seed_tools

        seed_agents(session)
        seed_tools(session)
