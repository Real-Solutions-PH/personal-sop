"""Per-route permission matrix for the admin surfaces.

Each admin route is guarded by a permission code ("resource:action"). A user
holding a role that grants the code is allowed through; a user whose role does
not grant it is refused with 403. Superusers bypass the check entirely.

The seeded role -> permission sets under test:
    superadmin -> every permission
    admin      -> users:read, users:write, roles:read, permissions:read,
                  tenants:read  (NOT users:delete)
    dpo        -> users:read (+ audit/data.*)
    user       -> items only

So, e.g., the admin role can list and create users but cannot delete one, and
the dpo role can read users but not roles.
"""

import uuid

import pytest
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


def _url(path: str) -> str:
    return f"{settings.API_V1_STR}{path}"


# (role, method, path, json_body) — the role's set grants the code the route
# requires, so the request clears the permission gate (status != 403).
_ALLOWED = [
    ("admin", "GET", "/users/", None),
    ("dpo", "GET", "/users/", None),
    ("admin", "GET", "/roles/", None),
    ("admin", "GET", "/tenants/", None),
    ("admin", "GET", "/permissions/", None),
    # admin holds users:write: an invalid body gets past the gate to 422.
    ("admin", "POST", "/users/", {}),
    # superadmin's "*" includes users:delete: bypasses the gate to 404.
    ("superadmin", "DELETE", f"/users/{uuid.uuid4()}", None),
]

# (role, method, path, json_body) — the role's set does NOT grant the code, so
# the request is refused at the gate with 403.
_DENIED = [
    ("user", "GET", "/users/", None),
    ("user", "GET", "/roles/", None),
    ("user", "GET", "/tenants/", None),
    ("user", "GET", "/permissions/", None),
    ("dpo", "GET", "/roles/", None),  # dpo lacks roles:read
    # admin lacks users:delete — a valid target still 403s at the gate.
    ("admin", "DELETE", f"/users/{uuid.uuid4()}", None),
    # user lacks users:write — a valid body still 403s (never reaches create).
    ("user", "POST", "/users/", {"email": "matrix-denied@example.com"}),
]


@pytest.mark.parametrize("role,method,path,body", _ALLOWED)
def test_role_is_allowed_through_permission_gate(
    client: TestClient,
    db: Session,
    role: str,
    method: str,
    path: str,
    body: dict[str, object] | None,
) -> None:
    headers = _headers_for_role(db, role)
    r = client.request(method, _url(path), headers=headers, json=body)
    assert r.status_code != 403, (
        f"{role} {method} {path} was refused (403) but its role grants the "
        f"required permission; got {r.status_code}"
    )


@pytest.mark.parametrize("role,method,path,body", _DENIED)
def test_role_is_denied_by_permission_gate(
    client: TestClient,
    db: Session,
    role: str,
    method: str,
    path: str,
    body: dict[str, object] | None,
) -> None:
    headers = _headers_for_role(db, role)
    r = client.request(method, _url(path), headers=headers, json=body)
    assert r.status_code == 403, (
        f"{role} {method} {path} should be refused (403) — its role lacks the "
        f"required permission; got {r.status_code}"
    )


def test_superuser_bypasses_every_admin_gate(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    for path in ("/users/", "/roles/", "/tenants/", "/permissions/"):
        r = client.get(_url(path), headers=superuser_token_headers)
        assert r.status_code == 200, f"superuser blocked from {path}: {r.status_code}"
