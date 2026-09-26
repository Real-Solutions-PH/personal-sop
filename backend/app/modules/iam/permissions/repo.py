import uuid

from sqlmodel import Session, col, func, select

from app.modules.iam.permissions.models import Permission


def get_by_id(*, session: Session, permission_id: uuid.UUID) -> Permission | None:
    return session.get(Permission, permission_id)


def get_by_name(*, session: Session, name: str) -> Permission | None:
    return session.exec(select(Permission).where(Permission.name == name)).first()


def get_multi(
    *, session: Session, skip: int = 0, limit: int = 200
) -> tuple[list[Permission], int]:
    count = session.exec(select(func.count()).select_from(Permission)).one()
    perms = session.exec(
        select(Permission)
        .order_by(col(Permission.resource), col(Permission.action))
        .offset(skip)
        .limit(limit)
    ).all()
    return list(perms), count


def create(*, session: Session, permission: Permission) -> Permission:
    session.add(permission)
    session.commit()
    session.refresh(permission)
    return permission
