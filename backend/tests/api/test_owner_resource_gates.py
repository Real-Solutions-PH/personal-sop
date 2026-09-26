"""Owner-scoped resources are permission-gated on top of ownership scoping.

Every provisioned user is granted the baseline ``user`` role, which carries
the item/ocr/conversation permissions, so ordinary users reach their own
resources. A role-less account (its baseline role revoked) is refused at the
permission gate — the service-level ownership check still applies underneath.
"""

from collections.abc import Generator

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlmodel import Session

from app.core import supabase_auth
from app.core.config import settings
from app.modules.ai.conversations.main import router as conversations_router
from app.modules.iam.rbac import repo as rbac_repo
from app.modules.iam.users import repo as user_repo
from app.modules.iam.users import services as user_service
from app.modules.ocr.main import router as ocr_router
from app.shared.errors import register_exception_handlers
from tests.utils.user import create_auth_user, user_authentication_headers
from tests.utils.utils import random_email, random_lower_string


def _url(path: str) -> str:
    return f"{settings.API_V1_STR}{path}"


@pytest.fixture(scope="module")
def aux_client() -> Generator[TestClient, None, None]:
    # OCR and conversations routers only mount on the main app behind feature
    # flags, so exercise their gates on a self-contained app.
    aux_app = FastAPI()
    register_exception_handlers(aux_app)
    aux_app.include_router(ocr_router, prefix=settings.API_V1_STR)
    aux_app.include_router(conversations_router, prefix=settings.API_V1_STR)
    with TestClient(aux_app) as c:
        yield c


def test_provisioning_assigns_default_role(db: Session) -> None:
    # A fresh GoTrue identity with no local mirror row, provisioned from claims,
    # comes out holding the baseline role's item permissions.
    email = random_email()
    uid = supabase_auth.admin_get_or_create_user(
        email=email, password=random_lower_string()
    )
    assert user_repo.get_by_id(session=db, user_id=uid) is None
    user = user_service.provision_user_from_claims(session=db, user_id=uid, email=email)
    perms = rbac_repo.get_user_permission_names(session=db, user_id=user.id)
    assert {"items:read", "items:write", "items:delete"} <= perms


def test_admin_created_user_holds_default_role(db: Session) -> None:
    # Superuser-driven creation must grant the baseline role too, so the
    # created account can reach its own owner-scoped resources.
    from app.modules.iam.users.schema import UserCreate

    user = user_service.create_user(
        session=db, user_in=UserCreate(email=random_email())
    )
    perms = rbac_repo.get_user_permission_names(session=db, user_id=user.id)
    assert {"items:read", "items:write", "items:delete"} <= perms


def test_private_endpoint_user_can_use_items(client: TestClient) -> None:
    # The local-only /private/users/ endpoint (the E2E suite's user factory)
    # mirrors JIT provisioning; the user it creates must hold the baseline
    # role, or ordinary users are refused at the items gate — both listing
    # (items:read) and creating (items:write).
    email = random_email()
    password = random_lower_string()
    r = client.post(
        _url("/private/users/"),
        json={"email": email, "password": password, "full_name": "T"},
    )
    assert r.status_code == 200
    headers = user_authentication_headers(email=email, password=password)
    assert client.get(_url("/items/"), headers=headers).status_code == 200
    created = client.post(_url("/items/"), headers=headers, json={"title": "x"})
    assert created.status_code == 200


def test_user_role_can_list_items(client: TestClient, db: Session) -> None:
    user, password = create_auth_user(db)  # granted the default role
    headers = user_authentication_headers(email=user.email, password=password)
    assert client.get(_url("/items/"), headers=headers).status_code == 200


def test_role_less_user_cannot_list_items(client: TestClient, db: Session) -> None:
    user, password = create_auth_user(db, assign_default_role=False)
    headers = user_authentication_headers(email=user.email, password=password)
    assert client.get(_url("/items/"), headers=headers).status_code == 403


def test_role_less_user_cannot_create_item(client: TestClient, db: Session) -> None:
    user, password = create_auth_user(db, assign_default_role=False)
    headers = user_authentication_headers(email=user.email, password=password)
    r = client.post(_url("/items/"), headers=headers, json={"title": "x"})
    assert r.status_code == 403


def test_role_less_user_cannot_list_ocr(aux_client: TestClient, db: Session) -> None:
    user, password = create_auth_user(db, assign_default_role=False)
    headers = user_authentication_headers(email=user.email, password=password)
    assert aux_client.get(_url("/ocr/"), headers=headers).status_code == 403


def test_user_role_can_list_ocr(aux_client: TestClient, db: Session) -> None:
    user, password = create_auth_user(db)  # granted the default role
    headers = user_authentication_headers(email=user.email, password=password)
    assert aux_client.get(_url("/ocr/"), headers=headers).status_code == 200


def test_role_less_user_cannot_list_conversations(
    aux_client: TestClient, db: Session
) -> None:
    user, password = create_auth_user(db, assign_default_role=False)
    headers = user_authentication_headers(email=user.email, password=password)
    r = aux_client.get(_url("/chat/conversations"), headers=headers)
    assert r.status_code == 403


def test_user_role_can_list_conversations(aux_client: TestClient, db: Session) -> None:
    user, password = create_auth_user(db)  # granted the default role
    headers = user_authentication_headers(email=user.email, password=password)
    r = aux_client.get(_url("/chat/conversations"), headers=headers)
    assert r.status_code == 200
