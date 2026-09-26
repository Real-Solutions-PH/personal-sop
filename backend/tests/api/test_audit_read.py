"""Read-only access to the append-only audit log, gated on ``audit:read``.

Needs the local Supabase stack (make supabase-up): callers authenticate through
GoTrue. The ``dpo`` role holds ``audit:read``; an ordinary user does not.
"""

from fastapi.testclient import TestClient
from sqlmodel import Session

from app.core.config import settings
from app.modules.audit import services as audit
from app.modules.iam.rbac import repo as rbac_repo
from app.modules.iam.roles import repo as role_repo
from tests.utils.user import create_auth_user, user_authentication_headers

_URL = f"{settings.API_V1_STR}/audit/logs"


def _dpo_headers(db: Session) -> dict[str, str]:
    user, password = create_auth_user(db, assign_default_role=False)
    role = role_repo.get_by_name(session=db, name="dpo")
    assert role is not None, "dpo role must be seeded"
    rbac_repo.assign_role_to_user(session=db, user_id=user.id, role_id=role.id)
    return user_authentication_headers(email=user.email, password=password)


def test_audit_read_forbidden_without_permission(
    client: TestClient, normal_user_token_headers: dict[str, str]
) -> None:
    r = client.get(_URL, headers=normal_user_token_headers)
    assert r.status_code == 403


def test_audit_read_allows_audit_read_holder(client: TestClient, db: Session) -> None:
    audit.record(session=db, action="test.read", target_type="thing", target_id="x")
    r = client.get(_URL, headers=_dpo_headers(db))
    assert r.status_code == 200
    body = r.json()
    assert "data" in body and "count" in body
    assert body["count"] >= 1
    assert all(
        {"id", "action", "target_type", "created_at"} <= set(row)
        for row in body["data"]
    )


def test_audit_read_superuser_bypass(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    r = client.get(_URL, headers=superuser_token_headers)
    assert r.status_code == 200


def test_audit_read_pagination_bounds(client: TestClient, db: Session) -> None:
    for i in range(3):
        audit.record(
            session=db, action="test.page", target_type="thing", target_id=str(i)
        )
    headers = _dpo_headers(db)
    r = client.get(f"{_URL}?limit=2", headers=headers)
    assert r.status_code == 200
    body = r.json()
    assert len(body["data"]) <= 2
    # count is the FULL total (>= the 3 just written), not the page size
    assert body["count"] >= 3
    # newest first
    timestamps = [row["created_at"] for row in body["data"]]
    assert timestamps == sorted(timestamps, reverse=True)
    # limit above the bound is rejected at the edge (422), not a full scan
    assert client.get(f"{_URL}?limit=101", headers=headers).status_code == 422
