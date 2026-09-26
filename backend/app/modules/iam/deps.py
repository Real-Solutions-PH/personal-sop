import json
import uuid
from collections.abc import Callable, Generator
from typing import Annotated

import jwt
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import Connection, event
from sqlmodel import Session

from app.core import supabase_auth
from app.core.db import app_engine
from app.modules.iam.users.models import User
from app.shared.deps import SessionDep

# auto_error=False so a missing header raises OUR 401 (with WWW-Authenticate,
# preserving the prior envelope semantics) instead of HTTPBearer's 403.
bearer_scheme = HTTPBearer(auto_error=False)


def get_bearer_token(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer_scheme)],
) -> str:
    if credentials is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return credentials.credentials


TokenDep = Annotated[str, Depends(get_bearer_token)]


def get_current_user(request: Request, session: SessionDep, token: TokenDep) -> User:
    try:
        claims = supabase_auth.verify_token(token)
        user_id = uuid.UUID(str(claims["sub"]))
    except jwt.exceptions.PyJWKClientConnectionError:
        # JWKS endpoint unreachable — an upstream outage, not a bad token.
        # Caught before PyJWTError (it's a subclass) so callers can retry.
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Authentication service unavailable",
        )
    except (jwt.PyJWTError, KeyError, ValueError):
        # A malformed/invalid/expired credential is an authentication failure,
        # not an authorization one → 401 + WWW-Authenticate, so a client knows
        # to re-authenticate rather than treating it as a permission denial.
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Could not validate credentials",
            headers={"WWW-Authenticate": "Bearer"},
        )
    # Claims seam: stash the verified claims for downstream request handling
    # (e.g. future request.jwt.claims GUC wiring for RLS — see the runbook).
    request.state.jwt_claims = claims
    user = session.get(User, user_id)
    if not user:
        # JIT provisioning: the Supabase auth UID is the local PK; first
        # sight of a valid token creates the mirror row.
        from app.modules.iam.users import services as user_service

        email = claims.get("email")
        if not email:
            # The credential verified but carries no usable identity → treat as
            # an authentication failure (401), same bucket as an invalid token.
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Token has no email claim",
                headers={"WWW-Authenticate": "Bearer"},
            )
        user = user_service.provision_user_from_claims(
            session=session, user_id=user_id, email=str(email)
        )
    if not user.is_active:
        # Authenticated but not permitted to use the system → 403, not 401:
        # the credential is valid, so a client must not sign the user out and
        # retry (GoTrue would keep issuing tokens for the disabled account).
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Inactive user"
        )
    return user


CurrentUser = Annotated[User, Depends(get_current_user)]


def get_current_active_superuser(current_user: CurrentUser) -> User:
    if not current_user.is_superuser:
        raise HTTPException(
            status_code=403, detail="The user doesn't have enough privileges"
        )
    return current_user


def require_permission(permission: str) -> Callable[..., User]:
    """Dependency factory: require ``permission`` ("resource:action").

    Superusers bypass the check (the ``is_superuser`` flag stays the
    platform-admin escape hatch); everyone else must hold the permission
    transitively via an assigned role. Use as::

        @router.get("/", dependencies=[Depends(require_permission("items:read"))])
    """

    def _dep(current_user: CurrentUser, session: SessionDep) -> User:
        if current_user.is_superuser:
            return current_user
        # Imported lazily: the rbac repo imports role/permission models whose
        # package pulls deps back through here at import time.
        from app.modules.iam.rbac import repo as rbac_repo

        held = rbac_repo.get_user_permission_names(
            session=session, user_id=current_user.id
        )
        if permission not in held:
            raise HTTPException(
                status_code=403, detail="The user doesn't have enough privileges"
            )
        return current_user

    return _dep


def _tenant_claims_json(user: User) -> str:
    """The ``request.jwt.claims`` payload RLS reads (Supabase-compatible).

    ``app_tenant_id()`` keys on ``->> 'tenant_id'``; the tenant is resolved
    from the authenticated user's row, not from the Supabase JWT (which does
    not carry it).
    """
    return json.dumps(
        {
            "sub": str(user.id),
            "tenant_id": str(user.tenant_id),
            "role": "authenticated",
        }
    )


def install_tenant_claims(session: Session, claims_json: str) -> None:
    """Set ``request.jwt.claims`` transaction-locally on every transaction of
    ``session``.

    Re-applied on each ``after_begin`` so a request that commits and reads
    again stays tenant-scoped — a transaction-local ``set_config`` resets the
    GUC to '' when its transaction ends.
    """

    @event.listens_for(session, "after_begin")
    def _set_claims(
        _session: Session, _transaction: object, connection: Connection
    ) -> None:
        connection.exec_driver_sql(
            "SELECT set_config('request.jwt.claims', %s, true)", (claims_json,)
        )


def get_tenant_session(current_user: CurrentUser) -> Generator[Session, None, None]:
    """RLS-enforced session bound to the app engine, carrying the caller's
    tenant claims (as Supabase PostgREST would inject them).

    Opt-in seam: a tenant-scoped route uses this in place of the owner-backed
    ``SessionDep`` so tenant isolation is enforced at the database. Superuser /
    platform-operator routes keep the owner session — under RLS the tenant
    policy would hide other tenants' rows.
    """
    with Session(app_engine) as session:
        install_tenant_claims(session, _tenant_claims_json(current_user))
        yield session


TenantSessionDep = Annotated[Session, Depends(get_tenant_session)]
