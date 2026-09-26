import uuid
from typing import Any

from sqlmodel import Session, col, delete, func, select

from app.modules.iam.users.models import User


def get_by_id(*, session: Session, user_id: uuid.UUID) -> User | None:
    return session.get(User, user_id)


def get_by_email(*, session: Session, email: str) -> User | None:
    statement = select(User).where(User.email == email)
    return session.exec(statement).first()


def get_multi(
    *, session: Session, skip: int = 0, limit: int = 100
) -> tuple[list[User], int]:
    count = session.exec(select(func.count()).select_from(User)).one()
    users = session.exec(
        select(User).order_by(col(User.created_at).desc()).offset(skip).limit(limit)
    ).all()
    return list(users), count


def create(*, session: Session, user: User) -> User:
    session.add(user)
    session.commit()
    session.refresh(user)
    return user


def update(*, session: Session, user: User, update_data: dict[str, Any]) -> User:
    user.sqlmodel_update(update_data)
    session.add(user)
    session.commit()
    session.refresh(user)
    return user


def delete_user(*, session: Session, user: User) -> None:
    session.delete(user)
    session.commit()


def delete_user_cascade(*, session: Session, user: User) -> None:
    from app.modules.items.models import Item

    statement = delete(Item).where(col(Item.owner_id) == user.id)
    session.exec(statement)
    session.delete(user)
    session.commit()
