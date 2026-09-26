"""GDPR data-subject endpoints: export (portability) and erase (right to erasure).

Needs the local Supabase stack (make supabase-up): the data subject and the
Data Protection Officer authenticate through GoTrue like every other auth test.

- Export: a user can export their own data (`/users/me/export`); a holder of
  ``data:export`` (the seeded ``dpo`` role) can export any user's.
- Erase: a holder of ``data:erase`` triggers the existing hard-delete, which
  revokes the auth identity and cascades the user's rows, and is audited.
"""

import uuid

from fastapi.testclient import TestClient
from sqlmodel import Session, col, select

from app.core.config import settings
from app.db.models import AuditLog, User
from app.modules.iam.rbac import repo as rbac_repo
from app.modules.iam.roles import repo as role_repo
from app.modules.iam.users import repo as user_repo
from tests.utils.user import create_auth_user, user_authentication_headers
from tests.utils.utils import random_email

_MISSING = "00000000-0000-0000-0000-000000000000"


def _dpo_headers(db: Session) -> dict[str, str]:
    """A user holding ONLY the dpo role (data:export + data:erase)."""
    user, password = create_auth_user(db, assign_default_role=False)
    role = role_repo.get_by_name(session=db, name="dpo")
    assert role is not None, "dpo role must be seeded"
    rbac_repo.assign_role_to_user(session=db, user_id=user.id, role_id=role.id)
    return user_authentication_headers(email=user.email, password=password)


def _superuser_id(db: Session) -> uuid.UUID:
    su = user_repo.get_by_email(session=db, email=settings.FIRST_SUPERUSER)
    assert su is not None, "FIRST_SUPERUSER must be bootstrapped"
    return su.id


def _last_audit(db: Session, action: str, target_id: object) -> AuditLog | None:
    return db.exec(
        select(AuditLog)
        .where(AuditLog.action == action, AuditLog.target_id == str(target_id))
        .order_by(col(AuditLog.created_at).desc())
    ).first()


def test_self_export_returns_own_data(
    client: TestClient, normal_user_token_headers: dict[str, str]
) -> None:
    r = client.get(
        f"{settings.API_V1_STR}/users/me/export", headers=normal_user_token_headers
    )
    assert r.status_code == 200
    body = r.json()
    assert set(body) >= {"user", "items"}
    # the caller's OWN record, not someone else's
    assert body["user"]["email"] == settings.EMAIL_TEST_USER


def test_admin_export_with_permission(client: TestClient, db: Session) -> None:
    headers = _dpo_headers(db)
    target, _ = create_auth_user(db)
    r = client.get(f"{settings.API_V1_STR}/users/{target.id}/export", headers=headers)
    assert r.status_code == 200
    assert r.json()["user"]["id"] == str(target.id)


def test_export_forbidden_without_permission(
    client: TestClient, normal_user_token_headers: dict[str, str], db: Session
) -> None:
    target, _ = create_auth_user(db)
    r = client.get(
        f"{settings.API_V1_STR}/users/{target.id}/export",
        headers=normal_user_token_headers,
    )
    assert r.status_code == 403


def test_export_unknown_user_404(client: TestClient, db: Session) -> None:
    headers = _dpo_headers(db)
    r = client.get(f"{settings.API_V1_STR}/users/{_MISSING}/export", headers=headers)
    assert r.status_code == 404


def test_erase_with_permission_hard_deletes_and_audits(
    client: TestClient, db: Session
) -> None:
    headers = _dpo_headers(db)
    target, _ = create_auth_user(db)
    r = client.delete(f"{settings.API_V1_STR}/users/{target.id}/erase", headers=headers)
    assert r.status_code == 200
    db.expunge_all()  # drop the identity map; re-read must hit the DB fresh
    assert db.get(User, target.id) is None
    row = db.exec(
        select(AuditLog).where(
            AuditLog.action == "user.delete",
            AuditLog.target_id == str(target.id),
        )
    ).first()
    assert row is not None


def test_erase_forbidden_without_permission(
    client: TestClient, normal_user_token_headers: dict[str, str], db: Session
) -> None:
    target, _ = create_auth_user(db)
    r = client.delete(
        f"{settings.API_V1_STR}/users/{target.id}/erase",
        headers=normal_user_token_headers,
    )
    assert r.status_code == 403


def test_erase_self_forbidden(client: TestClient, db: Session) -> None:
    """A data:erase holder cannot erase their own account through this route
    (the self-delete guard). Self-erasure would go via DELETE /users/me."""
    user, password = create_auth_user(db, assign_default_role=False)
    role = role_repo.get_by_name(session=db, name="dpo")
    assert role is not None
    rbac_repo.assign_role_to_user(session=db, user_id=user.id, role_id=role.id)
    headers = user_authentication_headers(email=user.email, password=password)
    r = client.delete(f"{settings.API_V1_STR}/users/{user.id}/erase", headers=headers)
    assert r.status_code == 403


def test_erase_unknown_user_404(client: TestClient, db: Session) -> None:
    headers = _dpo_headers(db)
    r = client.delete(f"{settings.API_V1_STR}/users/{_MISSING}/erase", headers=headers)
    assert r.status_code == 404


def test_create_user_records_acting_superuser(
    client: TestClient, superuser_token_headers: dict[str, str], db: Session
) -> None:
    su_id = _superuser_id(db)
    r = client.post(
        f"{settings.API_V1_STR}/users/",
        headers=superuser_token_headers,
        json={"email": random_email()},
    )
    assert r.status_code == 200
    created_id = r.json()["id"]
    row = _last_audit(db, "user.create", created_id)
    assert row is not None
    # the ACTOR is the caller, not the newly-created user
    assert row.actor_id == su_id
    assert str(row.actor_id) != created_id


def test_update_user_records_acting_superuser(
    client: TestClient, superuser_token_headers: dict[str, str], db: Session
) -> None:
    su_id = _superuser_id(db)
    target, _ = create_auth_user(db)
    r = client.patch(
        f"{settings.API_V1_STR}/users/{target.id}",
        headers=superuser_token_headers,
        json={"full_name": "Renamed By Admin"},
    )
    assert r.status_code == 200
    row = _last_audit(db, "user.update", target.id)
    assert row is not None
    assert row.actor_id == su_id


def test_rbac_route_records_acting_superuser(
    client: TestClient, superuser_token_headers: dict[str, str], db: Session
) -> None:
    """The headline of the audit work: a real /rbac call records WHO escalated
    privileges, threaded from the route's current_user."""
    su_id = _superuser_id(db)
    target, _ = create_auth_user(db, assign_default_role=False)
    role = role_repo.get_by_name(session=db, name="dpo")
    assert role is not None
    r = client.post(
        f"{settings.API_V1_STR}/rbac/users/{target.id}/roles/{role.id}",
        headers=superuser_token_headers,
    )
    assert r.status_code == 200
    row = _last_audit(db, "rbac.assign_role", target.id)
    assert row is not None
    assert row.actor_id == su_id
    assert row.after is not None and row.after["role_id"] == str(role.id)
