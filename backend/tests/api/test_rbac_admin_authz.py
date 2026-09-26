"""The /rbac assignment surface is gated on the ``rbac:manage`` permission.

Assigning roles and granting permissions was previously gated purely on the
``is_superuser`` flag. It is now gated on ``rbac:manage``, held by the
``superadmin`` role's "*" grant, so a superadmin-role account reaches it without
the raw flag. The superuser flag still bypasses; ordinary and admin-role users
are refused (assigning roles is a privilege-granting surface).
"""

from fastapi.testclient import TestClient
from sqlmodel import Session

from app.core.config import settings
from app.modules.iam.rbac import repo as rbac_repo
from app.modules.iam.roles import repo as role_repo
from tests.utils.user import create_auth_user, user_authentication_headers


def _headers_for_role(db: Session, role_name: str) -> dict[str, str]:
    user, password = create_auth_user(db)
    role = role_repo.get_by_name(session=db, name=role_name)
    assert role is not None, f"role {role_name!r} must be seeded"
    rbac_repo.assign_role_to_user(session=db, user_id=user.id, role_id=role.id)
    return user_authentication_headers(email=user.email, password=password)


def _dpo_id(db: Session) -> str:
    role = role_repo.get_by_name(session=db, name="dpo")
    assert role is not None
    return str(role.id)


def test_superadmin_role_can_assign_roles(client: TestClient, db: Session) -> None:
    headers = _headers_for_role(db, "superadmin")
    target, _ = create_auth_user(db)
    r = client.post(
        f"{settings.API_V1_STR}/rbac/users/{target.id}/roles/{_dpo_id(db)}",
        headers=headers,
    )
    assert r.status_code != 403


def test_admin_role_cannot_assign_roles(client: TestClient, db: Session) -> None:
    headers = _headers_for_role(db, "admin")
    target, _ = create_auth_user(db)
    r = client.post(
        f"{settings.API_V1_STR}/rbac/users/{target.id}/roles/{_dpo_id(db)}",
        headers=headers,
    )
    assert r.status_code == 403


def test_normal_user_cannot_assign_roles(
    client: TestClient, db: Session, normal_user_token_headers: dict[str, str]
) -> None:
    target, _ = create_auth_user(db)
    r = client.post(
        f"{settings.API_V1_STR}/rbac/users/{target.id}/roles/{_dpo_id(db)}",
        headers=normal_user_token_headers,
    )
    assert r.status_code == 403
