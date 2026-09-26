import uuid

from fastapi import HTTPException
from sqlmodel import Session

from app.modules.iam.permissions import repo as permission_repo
from app.modules.iam.permissions.models import Permission


def list_permissions(
    *, session: Session, skip: int = 0, limit: int = 200
) -> tuple[list[Permission], int]:
    return permission_repo.get_multi(session=session, skip=skip, limit=limit)


def get_permission(*, session: Session, permission_id: uuid.UUID) -> Permission:
    perm = permission_repo.get_by_id(session=session, permission_id=permission_id)
    if not perm:
        raise HTTPException(status_code=404, detail="Permission not found")
    return perm
