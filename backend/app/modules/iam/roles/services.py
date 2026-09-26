import uuid

from fastapi import HTTPException
from sqlmodel import Session

from app.modules.iam.roles import repo as role_repo
from app.modules.iam.roles.models import Role


def list_roles(
    *, session: Session, skip: int = 0, limit: int = 100
) -> tuple[list[Role], int]:
    return role_repo.get_multi(session=session, skip=skip, limit=limit)


def get_role(*, session: Session, role_id: uuid.UUID) -> Role:
    role = role_repo.get_by_id(session=session, role_id=role_id)
    if not role:
        raise HTTPException(status_code=404, detail="Role not found")
    return role
