import uuid

from sqlmodel import Session

from app.core import supabase_auth
from app.db.models import User
from app.modules.iam.tenants import services as tenant_service
from app.modules.iam.users import repo as user_repo
from tests.utils.utils import auth_headers, random_email, random_lower_string


def default_tenant_id(db: Session) -> uuid.UUID:
    return tenant_service.get_default_tenant(session=db).id


def create_random_user(db: Session, **overrides: object) -> User:
    """Local-only mirror row (no GoTrue identity) — for tests that never
    authenticate as this user."""
    user = User(
        email=random_email(),
        tenant_id=default_tenant_id(db),
        **overrides,  # type: ignore[arg-type]
    )
    return user_repo.create(session=db, user=user)


def create_auth_user(
    db: Session,
    *,
    email: str | None = None,
    password: str | None = None,
    tenant_id: uuid.UUID | None = None,
    assign_default_role: bool = True,
) -> tuple[User, str]:
    """GoTrue user (idempotent; password reset to a known value) + local
    mirror row keyed by the auth UID. Returns (user, password).

    Mirrors real JIT provisioning by granting the default role, so an
    authenticated test user can reach permission-gated owner resources.
    Pass ``assign_default_role=False`` for a bare, role-less user.
    """
    email = email or random_email()
    password = password or random_lower_string()
    auth_uid = supabase_auth.admin_get_or_create_user(email=email, password=password)
    user = user_repo.get_by_id(session=db, user_id=auth_uid)
    if not user:
        user = user_repo.create(
            session=db,
            user=User(
                id=auth_uid,
                email=email,
                tenant_id=tenant_id or default_tenant_id(db),
            ),
        )
    if assign_default_role:
        from app.modules.iam.users.services import assign_default_role as _assign

        _assign(session=db, user_id=user.id)
    return user, password


def user_authentication_headers(*, email: str, password: str) -> dict[str, str]:
    return auth_headers(email, password)


def authentication_token_from_email(*, email: str, db: Session) -> dict[str, str]:
    """Valid token headers for the user with the given email (created in
    GoTrue and mirrored locally if missing; password reset to a fresh one)."""
    user, password = create_auth_user(db, email=email)
    return auth_headers(user.email, password)
