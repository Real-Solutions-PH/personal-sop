import uuid

from sqlmodel import Session, col, func, select

from app.modules.iam.roles.models import Role


def get_by_id(*, session: Session, role_id: uuid.UUID) -> Role | None:
    return session.get(Role, role_id)


def get_by_name(*, session: Session, name: str) -> Role | None:
    return session.exec(select(Role).where(Role.name == name)).first()


def get_multi(
    *, session: Session, skip: int = 0, limit: int = 100
) -> tuple[list[Role], int]:
    count = session.exec(select(func.count()).select_from(Role)).one()
    roles = session.exec(
        select(Role).order_by(col(Role.name)).offset(skip).limit(limit)
    ).all()
    return list(roles), count


def create(*, session: Session, role: Role) -> Role:
    session.add(role)
    session.commit()
    session.refresh(role)
    return role
