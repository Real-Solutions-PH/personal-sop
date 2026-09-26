import uuid
from datetime import datetime, timezone
from typing import Any

import httpx
from fastapi import HTTPException
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session

from app.core import supabase_auth
from app.modules.audit import services as audit
from app.modules.iam.tenants import services as tenant_service
from app.modules.iam.users import repo as user_repo
from app.modules.iam.users.models import User
from app.modules.iam.users.schema import (
    UserCreate,
    UserUpdate,
    UserUpdateMe,
)
from app.modules.items import repo as item_repo

# Non-secret fields captured in audit snapshots (there are no credentials on
# the local mirror row — those live in Supabase Auth).
_USER_AUDIT_FIELDS = (
    "id",
    "email",
    "is_superuser",
    "is_active",
    "full_name",
    "deleted_at",
)

# The baseline role every human account holds. Provisioning grants it so a
# freshly seen user can reach their own tenant-scoped resources (items, OCR,
# conversations), which are permission-gated; elevated roles are additive.
DEFAULT_ROLE_NAME = "user"


def assign_default_role(*, session: Session, user_id: uuid.UUID) -> None:
    """Grant ``DEFAULT_ROLE_NAME`` to a user. Idempotent; a missing role (an
    unseeded database) is a silent no-op so provisioning never fails on it.

    Imported lazily: the rbac/roles repos pull role/permission models whose
    package would otherwise create an import cycle back through this module.
    """
    from app.modules.iam.rbac import repo as rbac_repo
    from app.modules.iam.roles import repo as role_repo

    role = role_repo.get_by_name(session=session, name=DEFAULT_ROLE_NAME)
    if role is not None:
        rbac_repo.assign_role_to_user(session=session, user_id=user_id, role_id=role.id)


def list_users(
    *, session: Session, skip: int = 0, limit: int = 100
) -> tuple[list[User], int]:
    return user_repo.get_multi(session=session, skip=skip, limit=limit)


def get_user_by_id(*, session: Session, user_id: uuid.UUID) -> User | None:
    return user_repo.get_by_id(session=session, user_id=user_id)


def create_user(
    *, session: Session, user_in: UserCreate, actor_id: uuid.UUID | None = None
) -> User:
    """Superuser-driven creation: GoTrue admin user + mirrored local row.

    The auth user is created without a password (email confirmed); the
    person signs in via Supabase recovery / magic link.

    ``actor_id`` is the acting superuser, for the audit trail; it is optional
    because the route does not yet forward the current user (see the audit
    module's actor note).
    """
    existing = user_repo.get_by_email(session=session, email=user_in.email)
    if existing:
        raise HTTPException(
            status_code=400,
            detail="The user with this email already exists in the system.",
        )
    try:
        auth_uid = supabase_auth.admin_get_or_create_user(
            email=user_in.email, adopt_existing=False
        )
    except supabase_auth.EmailExistsError:
        raise HTTPException(
            status_code=409,
            detail=(
                "email already registered with the auth provider — "
                "verify ownership before granting access"
            ),
        )
    tenant = tenant_service.get_default_tenant(session=session)
    db_user = User.model_validate(
        user_in, update={"id": auth_uid, "tenant_id": tenant.id}
    )
    db_user = user_repo.create(session=session, user=db_user)
    # Mirror JIT provisioning: a created human account holds the baseline role,
    # or it is refused at the owner-resource permission gates.
    assign_default_role(session=session, user_id=db_user.id)
    audit.record(
        session=session,
        actor_id=actor_id,
        action="user.create",
        target_type="user",
        target_id=db_user.id,
        after=audit.snapshot(db_user, _USER_AUDIT_FIELDS),
    )
    return db_user


def provision_user_from_claims(
    *, session: Session, user_id: uuid.UUID, email: str
) -> User:
    """JIT-provision the local mirror row for a verified Supabase token.

    Race-safe: a concurrent insert of the same id loses the unique check,
    rolls back, and re-reads the winner's row.

    Before creating anything, the auth identity is re-checked against
    GoTrue: a deleted user's access token stays signature-valid until
    ``exp``, and without this check it would silently resurrect the
    account (local row re-created from stale claims).
    """
    if not supabase_auth.admin_user_exists(user_id):
        raise HTTPException(status_code=401, detail="Auth user no longer exists")
    tenant = tenant_service.get_default_tenant(session=session)
    user = User(id=user_id, email=email, is_active=True, tenant_id=tenant.id)
    session.add(user)
    try:
        session.commit()
    except IntegrityError:
        session.rollback()
        existing = user_repo.get_by_id(session=session, user_id=user_id)
        if existing is None:
            # Same email under a different id — stale pre-Supabase row.
            raise HTTPException(
                status_code=409,
                detail="A user with this email already exists under another id",
            )
        return existing
    session.refresh(user)
    assign_default_role(session=session, user_id=user.id)
    return user


def _sync_email_to_gotrue(*, user: User, new_email: str | None) -> None:
    """Propagate a local email change to the GoTrue identity.

    Called BEFORE the local commit: if GoTrue rejects the change the local
    row is left untouched and the request fails with a 502 envelope, so the
    two stores can't drift apart.
    """
    if not new_email or new_email == user.email:
        return
    try:
        supabase_auth.admin_update_email(user.id, new_email)
    except httpx.HTTPError:
        raise HTTPException(
            status_code=502,
            detail="Failed to update the email with the auth provider",
        )


def update_user(
    *,
    session: Session,
    user_id: uuid.UUID,
    user_in: UserUpdate,
    actor_id: uuid.UUID | None = None,
) -> User:
    """Superuser-driven update. The GoTrue email is changed via the admin API
    (authoritative, marked confirmed) — this is a privileged admin action and
    is audited. Self-service email changes go through ``update_user_me``,
    which deliberately cannot take this shortcut."""
    db_user = user_repo.get_by_id(session=session, user_id=user_id)
    if not db_user:
        raise HTTPException(
            status_code=404,
            detail="The user with this id does not exist in the system",
        )
    if user_in.email:
        existing = user_repo.get_by_email(session=session, email=user_in.email)
        if existing and existing.id != user_id:
            raise HTTPException(
                status_code=409, detail="User with this email already exists"
            )
    _sync_email_to_gotrue(user=db_user, new_email=user_in.email)
    before = audit.snapshot(db_user, _USER_AUDIT_FIELDS)
    user_data = user_in.model_dump(exclude_unset=True)
    updated = user_repo.update(session=session, user=db_user, update_data=user_data)
    audit.record(
        session=session,
        actor_id=actor_id,
        action="user.update",
        target_type="user",
        target_id=updated.id,
        before=before,
        after=audit.snapshot(updated, _USER_AUDIT_FIELDS),
    )
    return updated


def update_user_me(
    *, session: Session, current_user: User, user_in: UserUpdateMe
) -> User:
    """Self-service profile update.

    Email changes are intentionally NOT applied here. The old path pushed the
    new address straight through the GoTrue *admin* API with
    ``email_confirm=True``, marking an address the user never proved they own
    as confirmed — an account-takeover primitive. A proper user-initiated,
    double-confirmation email change (GoTrue ``PUT /auth/v1/user``) needs the
    user's own access token forwarded from the route and working SMTP; until
    that is wired, self-service email change is refused rather than done
    insecurely. Superusers can still change a user's email via
    ``update_user``.
    """
    if user_in.email and user_in.email != current_user.email:
        raise HTTPException(
            status_code=400,
            detail=(
                "Self-service email changes are not supported; changing the "
                "account email requires verifying ownership of the new address."
            ),
        )
    update_data = user_in.model_dump(exclude_unset=True)
    # Never write email through this path, even when unchanged.
    update_data.pop("email", None)
    return user_repo.update(session=session, user=current_user, update_data=update_data)


def _revoke_gotrue_identity(user_id: uuid.UUID) -> None:
    """Revoke the GoTrue identity BEFORE the local row is deleted/committed.

    Mirrors ``_sync_email_to_gotrue``: call GoTrue first so a provider
    failure aborts the request (502 envelope) with the local row and its
    data untouched, instead of leaving a half-deleted account whose live
    auth identity would JIT-resurrect an empty row on the next request.
    ``admin_delete_user`` already tolerates an already-gone identity
    (GoTrue 404), so re-revoking is a safe no-op.
    """
    try:
        supabase_auth.admin_delete_user(user_id)
    except httpx.HTTPError:
        raise HTTPException(
            status_code=502,
            detail="Failed to delete the user with the auth provider",
        )


def delete_user_me(*, session: Session, current_user: User) -> None:
    if current_user.is_superuser:
        raise HTTPException(
            status_code=403,
            detail="Super users are not allowed to delete themselves",
        )
    before = audit.snapshot(current_user, _USER_AUDIT_FIELDS)
    actor_id = current_user.id
    _revoke_gotrue_identity(current_user.id)
    user_repo.delete_user(session=session, user=current_user)
    audit.record(
        session=session,
        actor_id=actor_id,
        action="user.delete_self",
        target_type="user",
        target_id=actor_id,
        before=before,
    )


def delete_user(*, session: Session, current_user: User, user_id: uuid.UUID) -> None:
    user = user_repo.get_by_id(session=session, user_id=user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if user == current_user:
        raise HTTPException(
            status_code=403,
            detail="Super users are not allowed to delete themselves",
        )
    before = audit.snapshot(user, _USER_AUDIT_FIELDS)
    _revoke_gotrue_identity(user_id)
    user_repo.delete_user_cascade(session=session, user=user)
    audit.record(
        session=session,
        actor_id=current_user.id,
        action="user.delete",
        target_type="user",
        target_id=user_id,
        before=before,
    )


def soft_delete_user(
    *, session: Session, user: User, actor_id: uuid.UUID | None = None
) -> User:
    """Logically delete a user (retention convention, reversible).

    Sets ``deleted_at`` and deactivates the account so the still-valid access
    token is rejected at the auth boundary (the ``is_active`` gate), while the
    row and its data are retained. This is distinct from erasure — the
    irreversible hard delete in ``delete_user`` that also revokes the GoTrue
    identity. See docs/data-protection.md.
    """
    before = audit.snapshot(user, _USER_AUDIT_FIELDS)
    updated = user_repo.update(
        session=session,
        user=user,
        update_data={"deleted_at": datetime.now(timezone.utc), "is_active": False},
    )
    audit.record(
        session=session,
        actor_id=actor_id,
        action="user.soft_delete",
        target_type="user",
        target_id=user.id,
        before=before,
        after=audit.snapshot(updated, _USER_AUDIT_FIELDS),
    )
    return updated


def export_user_data(*, session: Session, user_id: uuid.UUID) -> dict[str, Any]:
    """Portable dump of everything held about one user (GDPR data export).

    Returns the user's profile row plus all their items, including any
    soft-deleted rows still retained. Contains no credentials — those live in
    Supabase Auth, never in this store. See docs/data-protection.md.
    """
    user = user_repo.get_by_id(session=session, user_id=user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    items = item_repo.list_all_by_owner(session=session, owner_id=user_id)
    return {
        "user": user.model_dump(mode="json"),
        "items": [item.model_dump(mode="json") for item in items],
    }


def read_user_by_id(
    *, session: Session, user_id: uuid.UUID, current_user: User
) -> User:
    user = user_repo.get_by_id(session=session, user_id=user_id)
    if user == current_user:
        return user
    if not current_user.is_superuser:
        raise HTTPException(
            status_code=403,
            detail="The user doesn't have enough privileges",
        )
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    return user
