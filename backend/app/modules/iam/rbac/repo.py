import uuid

from sqlmodel import Session, col, select

from app.modules.iam.permissions.models import Permission
from app.modules.iam.rbac.models import RolePermission, UserRole
from app.modules.iam.roles.models import Role


def get_user_permission_names(*, session: Session, user_id: uuid.UUID) -> set[str]:
    """All permission names a user holds transitively via their roles."""
    stmt = (
        select(Permission.name)
        .join(RolePermission, col(RolePermission.permission_id) == col(Permission.id))
        .join(UserRole, col(UserRole.role_id) == col(RolePermission.role_id))
        .where(UserRole.user_id == user_id)
    )
    return set(session.exec(stmt).all())


def get_user_roles(*, session: Session, user_id: uuid.UUID) -> list[Role]:
    stmt = (
        select(Role)
        .join(UserRole, col(UserRole.role_id) == col(Role.id))
        .where(UserRole.user_id == user_id)
        .order_by(col(Role.name))
    )
    return list(session.exec(stmt).all())


def get_role_permissions(*, session: Session, role_id: uuid.UUID) -> list[Permission]:
    stmt = (
        select(Permission)
        .join(RolePermission, col(RolePermission.permission_id) == col(Permission.id))
        .where(RolePermission.role_id == role_id)
        .order_by(col(Permission.resource), col(Permission.action))
    )
    return list(session.exec(stmt).all())


def assign_role_to_user(
    *, session: Session, user_id: uuid.UUID, role_id: uuid.UUID
) -> None:
    """Idempotent: assigning an already-held role is a no-op."""
    if session.get(UserRole, (user_id, role_id)) is None:
        session.add(UserRole(user_id=user_id, role_id=role_id))
        session.commit()


def remove_role_from_user(
    *, session: Session, user_id: uuid.UUID, role_id: uuid.UUID
) -> None:
    link = session.get(UserRole, (user_id, role_id))
    if link is not None:
        session.delete(link)
        session.commit()


def add_permission_to_role(
    *, session: Session, role_id: uuid.UUID, permission_id: uuid.UUID
) -> None:
    """Idempotent: granting an already-held permission is a no-op."""
    if session.get(RolePermission, (role_id, permission_id)) is None:
        session.add(RolePermission(role_id=role_id, permission_id=permission_id))
        session.commit()


def remove_permission_from_role(
    *, session: Session, role_id: uuid.UUID, permission_id: uuid.UUID
) -> None:
    link = session.get(RolePermission, (role_id, permission_id))
    if link is not None:
        session.delete(link)
        session.commit()
