"""Audit trail for the RBAC privilege-escalation surface.

Assigning a role or granting a permission changes what an account can do, so
each such change writes an append-only audit row (who, what, target). Driven
at the service layer — mirrors tests/shared/test_audit_log.py — so the checks
don't depend on minting real GoTrue tokens. A no-op (re-assigning a role the
user already holds, or removing one they never had) must NOT write a row.
"""

import uuid

from sqlmodel import Session, col, func, select

from app.db.models import AuditLog
from app.modules.iam.permissions import repo as permission_repo
from app.modules.iam.rbac import services as rbac_service
from app.modules.iam.roles import repo as role_repo
from app.modules.iam.roles.models import Role
from tests.utils.user import create_random_user


def _count(db: Session, action: str) -> int:
    return db.exec(
        select(func.count()).select_from(AuditLog).where(AuditLog.action == action)
    ).one()


def _last(db: Session, action: str, target_id: object) -> AuditLog:
    row = db.exec(
        select(AuditLog)
        .where(AuditLog.action == action, AuditLog.target_id == str(target_id))
        .order_by(col(AuditLog.created_at).desc())
    ).first()
    assert row is not None
    return row


def _seeded_role_id(db: Session, name: str) -> uuid.UUID:
    role = role_repo.get_by_name(session=db, name=name)
    assert role is not None, f"role {name!r} must be seeded"
    return role.id


def _seeded_perm_id(db: Session, name: str) -> uuid.UUID:
    perm = permission_repo.get_by_name(session=db, name=name)
    assert perm is not None, f"permission {name!r} must be seeded"
    return perm.id


def _tmp_role(db: Session) -> Role:
    """A throwaway role so permission-grant tests never mutate a seeded one."""
    return role_repo.create(
        session=db,
        role=Role(name=f"tmp-{uuid.uuid4().hex[:12]}", description="test scratch"),
    )


def test_assign_role_is_audited(db: Session) -> None:
    actor = create_random_user(db)
    user = create_random_user(db)
    role_id = _seeded_role_id(db, "dpo")
    before = _count(db, "rbac.assign_role")
    rbac_service.assign_role_to_user(
        session=db, user_id=user.id, role_id=role_id, actor_id=actor.id
    )
    assert _count(db, "rbac.assign_role") == before + 1
    row = _last(db, "rbac.assign_role", user.id)
    assert row.actor_id == actor.id
    assert row.target_type == "user"
    assert row.after is not None and row.after["role_id"] == str(role_id)


def test_remove_role_is_audited_with_no_actor(db: Session) -> None:
    user = create_random_user(db)
    role_id = _seeded_role_id(db, "dpo")
    rbac_service.assign_role_to_user(session=db, user_id=user.id, role_id=role_id)
    before = _count(db, "rbac.remove_role")
    rbac_service.remove_role_from_user(session=db, user_id=user.id, role_id=role_id)
    assert _count(db, "rbac.remove_role") == before + 1
    row = _last(db, "rbac.remove_role", user.id)
    assert row.actor_id is None  # actor not passed -> unattributed
    assert row.before is not None and row.before["role_id"] == str(role_id)


def test_grant_permission_is_audited(db: Session) -> None:
    role = _tmp_role(db)
    perm_id = _seeded_perm_id(db, "items:read")
    before = _count(db, "rbac.grant_permission")
    rbac_service.add_permission_to_role(
        session=db, role_id=role.id, permission_id=perm_id, actor_id=None
    )
    assert _count(db, "rbac.grant_permission") == before + 1
    row = _last(db, "rbac.grant_permission", role.id)
    assert row.target_type == "role"
    assert row.after is not None and row.after["permission_id"] == str(perm_id)


def test_revoke_permission_is_audited(db: Session) -> None:
    role = _tmp_role(db)
    perm_id = _seeded_perm_id(db, "items:read")
    rbac_service.add_permission_to_role(
        session=db, role_id=role.id, permission_id=perm_id
    )
    before = _count(db, "rbac.revoke_permission")
    rbac_service.remove_permission_from_role(
        session=db, role_id=role.id, permission_id=perm_id
    )
    assert _count(db, "rbac.revoke_permission") == before + 1
    row = _last(db, "rbac.revoke_permission", role.id)
    assert row.before is not None and row.before["permission_id"] == str(perm_id)


def test_noop_reassign_is_not_audited(db: Session) -> None:
    user = create_random_user(db)
    role_id = _seeded_role_id(db, "dpo")
    rbac_service.assign_role_to_user(session=db, user_id=user.id, role_id=role_id)
    before = _count(db, "rbac.assign_role")
    # already held -> repo no-op -> no audit row
    rbac_service.assign_role_to_user(session=db, user_id=user.id, role_id=role_id)
    assert _count(db, "rbac.assign_role") == before


def test_noop_remove_is_not_audited(db: Session) -> None:
    user = create_random_user(db)
    role_id = _seeded_role_id(db, "dpo")  # never assigned to this user
    before = _count(db, "rbac.remove_role")
    rbac_service.remove_role_from_user(session=db, user_id=user.id, role_id=role_id)
    assert _count(db, "rbac.remove_role") == before


def test_noop_grant_permission_is_not_audited(db: Session) -> None:
    role = _tmp_role(db)
    perm_id = _seeded_perm_id(db, "items:read")
    rbac_service.add_permission_to_role(
        session=db, role_id=role.id, permission_id=perm_id
    )
    before = _count(db, "rbac.grant_permission")
    # already granted -> repo no-op -> no audit row
    rbac_service.add_permission_to_role(
        session=db, role_id=role.id, permission_id=perm_id
    )
    assert _count(db, "rbac.grant_permission") == before


def test_noop_revoke_permission_is_not_audited(db: Session) -> None:
    role = _tmp_role(db)
    perm_id = _seeded_perm_id(db, "items:read")  # never granted to this role
    before = _count(db, "rbac.revoke_permission")
    rbac_service.remove_permission_from_role(
        session=db, role_id=role.id, permission_id=perm_id
    )
    assert _count(db, "rbac.revoke_permission") == before
