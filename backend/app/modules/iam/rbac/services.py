import uuid

from fastapi import HTTPException
from sqlmodel import Session

from app.modules.audit import services as audit
from app.modules.iam.permissions import repo as permission_repo
from app.modules.iam.permissions.schema import PermissionPublic
from app.modules.iam.rbac import repo as rbac_repo
from app.modules.iam.rbac.schema import UserPermissions
from app.modules.iam.roles import repo as role_repo
from app.modules.iam.roles.schema import RolePublic
from app.modules.iam.users import repo as user_repo


def _require_user(session: Session, user_id: uuid.UUID) -> None:
    if user_repo.get_by_id(session=session, user_id=user_id) is None:
        raise HTTPException(status_code=404, detail="User not found")


def _require_role(session: Session, role_id: uuid.UUID) -> None:
    if role_repo.get_by_id(session=session, role_id=role_id) is None:
        raise HTTPException(status_code=404, detail="Role not found")


def _require_permission(session: Session, permission_id: uuid.UUID) -> None:
    if permission_repo.get_by_id(session=session, permission_id=permission_id) is None:
        raise HTTPException(status_code=404, detail="Permission not found")


# Membership checks used to gate the audit write so an idempotent repo no-op
# never produces a row. Read-before-mutate: two concurrent identical mutations
# can each see "changed" and both write a row (over-report), but a real change
# is never missed — the safe direction for an append-only trail. Tightening
# this would need the repo to report whether it actually mutated.
def _user_has_role(session: Session, user_id: uuid.UUID, role_id: uuid.UUID) -> bool:
    return any(
        r.id == role_id
        for r in rbac_repo.get_user_roles(session=session, user_id=user_id)
    )


def _role_has_permission(
    session: Session, role_id: uuid.UUID, permission_id: uuid.UUID
) -> bool:
    return any(
        p.id == permission_id
        for p in rbac_repo.get_role_permissions(session=session, role_id=role_id)
    )


def assign_role_to_user(
    *,
    session: Session,
    user_id: uuid.UUID,
    role_id: uuid.UUID,
    actor_id: uuid.UUID | None = None,
) -> None:
    _require_user(session, user_id)
    _require_role(session, role_id)
    # Only audit a real grant: the repo assign is an idempotent no-op when the
    # role is already held, and an audit row must never claim a change that did
    # not happen (mirrors the tool.remove_from_agent no-op convention).
    changed = not _user_has_role(session, user_id, role_id)
    rbac_repo.assign_role_to_user(session=session, user_id=user_id, role_id=role_id)
    if changed:
        audit.record(
            session=session,
            actor_id=actor_id,
            action="rbac.assign_role",
            target_type="user",
            target_id=user_id,
            after={"user_id": str(user_id), "role_id": str(role_id)},
        )


def remove_role_from_user(
    *,
    session: Session,
    user_id: uuid.UUID,
    role_id: uuid.UUID,
    actor_id: uuid.UUID | None = None,
) -> None:
    _require_user(session, user_id)
    _require_role(session, role_id)
    changed = _user_has_role(session, user_id, role_id)
    rbac_repo.remove_role_from_user(session=session, user_id=user_id, role_id=role_id)
    if changed:
        audit.record(
            session=session,
            actor_id=actor_id,
            action="rbac.remove_role",
            target_type="user",
            target_id=user_id,
            before={"user_id": str(user_id), "role_id": str(role_id)},
        )


def add_permission_to_role(
    *,
    session: Session,
    role_id: uuid.UUID,
    permission_id: uuid.UUID,
    actor_id: uuid.UUID | None = None,
) -> None:
    _require_role(session, role_id)
    _require_permission(session, permission_id)
    changed = not _role_has_permission(session, role_id, permission_id)
    rbac_repo.add_permission_to_role(
        session=session, role_id=role_id, permission_id=permission_id
    )
    if changed:
        audit.record(
            session=session,
            actor_id=actor_id,
            action="rbac.grant_permission",
            target_type="role",
            target_id=role_id,
            after={"role_id": str(role_id), "permission_id": str(permission_id)},
        )


def remove_permission_from_role(
    *,
    session: Session,
    role_id: uuid.UUID,
    permission_id: uuid.UUID,
    actor_id: uuid.UUID | None = None,
) -> None:
    _require_role(session, role_id)
    _require_permission(session, permission_id)
    changed = _role_has_permission(session, role_id, permission_id)
    rbac_repo.remove_permission_from_role(
        session=session, role_id=role_id, permission_id=permission_id
    )
    if changed:
        audit.record(
            session=session,
            actor_id=actor_id,
            action="rbac.revoke_permission",
            target_type="role",
            target_id=role_id,
            before={"role_id": str(role_id), "permission_id": str(permission_id)},
        )


def get_user_permissions(*, session: Session, user_id: uuid.UUID) -> UserPermissions:
    _require_user(session, user_id)
    roles = rbac_repo.get_user_roles(session=session, user_id=user_id)
    # Deduplicate permissions across roles, keyed by permission id.
    seen: dict[uuid.UUID, PermissionPublic] = {}
    for role in roles:
        for perm in rbac_repo.get_role_permissions(session=session, role_id=role.id):
            seen.setdefault(perm.id, PermissionPublic.model_validate(perm))
    return UserPermissions(
        roles=[RolePublic.model_validate(r) for r in roles],
        permissions=list(seen.values()),
    )
