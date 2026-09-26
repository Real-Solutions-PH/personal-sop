"""RBAC: role/permission assignment, effective-permission resolution, and the
``require_permission`` dependency.

Needs the local Supabase stack (make supabase-up): normal users authenticate
through GoTrue like every other auth test.
"""

from collections.abc import Generator

import pytest
from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient
from sqlmodel import Session

from app.core.config import settings
from app.modules.iam.deps import require_permission
from app.modules.iam.roles import repo as role_repo
from app.shared.errors import register_exception_handlers
from tests.utils.user import create_auth_user, user_authentication_headers


@pytest.fixture(scope="module")
def guarded_client() -> Generator[TestClient, None, None]:
    """Aux app exposing a route gated by require_permission("items:read")."""
    app = FastAPI()
    register_exception_handlers(app)

    @app.get(
        f"{settings.API_V1_STR}/guarded",
        dependencies=[Depends(require_permission("items:read"))],
    )
    def guarded() -> dict[str, bool]:
        return {"ok": True}

    with TestClient(app) as c:
        yield c


def _role_id(db: Session, name: str) -> str:
    role = role_repo.get_by_name(session=db, name=name)
    assert role is not None, f"role {name!r} must be seeded"
    return str(role.id)


# --- seed wiring -----------------------------------------------------------


def test_dpo_role_seeded_with_data_erase(
    client: TestClient, superuser_token_headers: dict[str, str], db: Session
) -> None:
    dpo_id = _role_id(db, "dpo")
    r = client.get(
        f"{settings.API_V1_STR}/rbac/roles/{dpo_id}/permissions",
        headers=superuser_token_headers,
    )
    assert r.status_code == 200
    names = {p["name"] for p in r.json()["data"]}
    assert {"data:erase", "data:export", "audit:read"} <= names
    assert "items:delete" not in names  # DPO is not an admin


# --- assignment + resolution ----------------------------------------------


def test_assign_and_revoke_role(
    client: TestClient, superuser_token_headers: dict[str, str], db: Session
) -> None:
    # Bare user so the assertions below see exactly the role assigned here.
    user, _ = create_auth_user(db, assign_default_role=False)
    dpo_id = _role_id(db, "dpo")
    base = f"{settings.API_V1_STR}/rbac/users/{user.id}"

    assert (
        client.post(
            f"{base}/roles/{dpo_id}", headers=superuser_token_headers
        ).status_code
        == 200
    )
    # Idempotent: assigning again is still 200.
    assert (
        client.post(
            f"{base}/roles/{dpo_id}", headers=superuser_token_headers
        ).status_code
        == 200
    )

    r = client.get(f"{base}/permissions", headers=superuser_token_headers)
    assert r.status_code == 200
    body = r.json()
    assert {role["name"] for role in body["roles"]} == {"dpo"}
    assert "data:erase" in {p["name"] for p in body["permissions"]}

    assert (
        client.delete(
            f"{base}/roles/{dpo_id}", headers=superuser_token_headers
        ).status_code
        == 200
    )
    r = client.get(f"{base}/permissions", headers=superuser_token_headers)
    assert r.json()["roles"] == []


def test_assign_unknown_role_or_user_404(
    client: TestClient, superuser_token_headers: dict[str, str], db: Session
) -> None:
    user, _ = create_auth_user(db)
    missing = "00000000-0000-0000-0000-000000000000"
    assert (
        client.post(
            f"{settings.API_V1_STR}/rbac/users/{user.id}/roles/{missing}",
            headers=superuser_token_headers,
        ).status_code
        == 404
    )
    dpo_id = _role_id(db, "dpo")
    assert (
        client.post(
            f"{settings.API_V1_STR}/rbac/users/{missing}/roles/{dpo_id}",
            headers=superuser_token_headers,
        ).status_code
        == 404
    )


def test_rbac_routes_are_superuser_only(
    client: TestClient, normal_user_token_headers: dict[str, str], db: Session
) -> None:
    user, _ = create_auth_user(db)
    dpo_id = _role_id(db, "dpo")
    r = client.post(
        f"{settings.API_V1_STR}/rbac/users/{user.id}/roles/{dpo_id}",
        headers=normal_user_token_headers,
    )
    assert r.status_code == 403


# --- require_permission dependency ----------------------------------------


def test_require_permission_denies_then_allows(
    guarded_client: TestClient,
    superuser_token_headers: dict[str, str],
    db: Session,
) -> None:
    user, password = create_auth_user(db, assign_default_role=False)
    headers = user_authentication_headers(email=user.email, password=password)
    url = f"{settings.API_V1_STR}/guarded"

    # No roles yet -> lacks items:read -> 403.
    assert guarded_client.get(url, headers=headers).status_code == 403

    # Grant via the seeded "user" role (has items:read).
    role_repo_role = role_repo.get_by_name(session=db, name="user")
    assert role_repo_role is not None
    from app.modules.iam.rbac import repo as rbac_repo

    rbac_repo.assign_role_to_user(
        session=db, user_id=user.id, role_id=role_repo_role.id
    )
    assert guarded_client.get(url, headers=headers).status_code == 200

    # Superuser bypasses require_permission entirely.
    assert guarded_client.get(url, headers=superuser_token_headers).status_code == 200
