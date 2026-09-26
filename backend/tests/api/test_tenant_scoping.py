"""Cross-tenant isolation tests.

Rule under test: the tenant filter lives in the query, so a row outside the
caller's tenant is simply invisible -> 404. Owner mismatches *within* a tenant
keep their existing 403 semantics (covered by tests/api/routes/test_items.py).

OCR and AI chat routers are mounted on an auxiliary app because the main app
only includes them when OCR_ENABLED / AI_ENABLED are set.
"""

import uuid
from collections.abc import Generator

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.core import supabase_auth
from app.core.config import settings
from app.db.models import Conversation, Item, OcrDocument, Tenant, User
from app.modules.ai.conversations.main import router as conversations_router
from app.modules.iam.tenants import repo as tenant_repo
from app.modules.ocr.main import router as ocr_router
from app.shared.errors import register_exception_handlers
from tests.utils.user import create_auth_user, user_authentication_headers
from tests.utils.utils import random_email, random_lower_string


@pytest.fixture(scope="module")
def aux_client() -> Generator[TestClient, None, None]:
    """Client for the OCR + AI chat routers, mounted regardless of flags."""
    aux_app = FastAPI()
    register_exception_handlers(aux_app)
    aux_app.include_router(ocr_router, prefix=settings.API_V1_STR)
    aux_app.include_router(conversations_router, prefix=settings.API_V1_STR)
    with TestClient(aux_app) as c:
        yield c


@pytest.fixture(scope="module")
def default_tenant(db: Session) -> Tenant:
    tenant = tenant_repo.get_by_slug(session=db, slug=settings.DEFAULT_TENANT_SLUG)
    assert tenant is not None, "default tenant must be seeded by init_db"
    return tenant


@pytest.fixture(scope="module")
def tenant_b(db: Session) -> Tenant:
    tenant = Tenant(name="Tenant B", slug=f"tenant-b-{random_lower_string()[:8]}")
    db.add(tenant)
    db.commit()
    db.refresh(tenant)
    return tenant


def _create_user(db: Session, tenant_id: uuid.UUID) -> tuple[User, str]:
    # GoTrue identity + local row pinned to the requested tenant (created
    # BEFORE any request so JIT provisioning can't assign the default one).
    return create_auth_user(db, tenant_id=tenant_id)


@pytest.fixture(scope="module")
def user_a(db: Session, default_tenant: Tenant) -> tuple[User, str]:
    return _create_user(db, default_tenant.id)


@pytest.fixture(scope="module")
def user_b(db: Session, tenant_b: Tenant) -> tuple[User, str]:
    return _create_user(db, tenant_b.id)


@pytest.fixture(scope="module")
def user_b_headers(user_b: tuple[User, str]) -> dict[str, str]:
    user, password = user_b
    return user_authentication_headers(email=user.email, password=password)


@pytest.fixture(scope="module")
def item_a(db: Session, user_a: tuple[User, str], default_tenant: Tenant) -> Item:
    item = Item(
        title="tenant-a item",
        owner_id=user_a[0].id,
        tenant_id=default_tenant.id,
    )
    db.add(item)
    db.commit()
    db.refresh(item)
    return item


@pytest.fixture(scope="module")
def ocr_doc_a(
    db: Session, user_a: tuple[User, str], default_tenant: Tenant
) -> OcrDocument:
    doc = OcrDocument(
        original_filename="a.png",
        mime_type="image/png",
        minio_key=f"ocr/{user_a[0].id}/{uuid.uuid4()}.png",
        owner_id=user_a[0].id,
        tenant_id=default_tenant.id,
    )
    db.add(doc)
    db.commit()
    db.refresh(doc)
    return doc


@pytest.fixture(scope="module")
def conversation_a(
    db: Session, user_a: tuple[User, str], default_tenant: Tenant
) -> Conversation:
    conv = Conversation(user_id=user_a[0].id, tenant_id=default_tenant.id)
    db.add(conv)
    db.commit()
    db.refresh(conv)
    return conv


# --- cross-tenant detail routes return 404 (row invisible, no existence leak)


def test_cross_tenant_item_read_is_404(
    client: TestClient, user_b_headers: dict[str, str], item_a: Item
) -> None:
    r = client.get(f"{settings.API_V1_STR}/items/{item_a.id}", headers=user_b_headers)
    assert r.status_code == 404


def test_cross_tenant_item_update_is_404(
    client: TestClient, user_b_headers: dict[str, str], item_a: Item
) -> None:
    r = client.put(
        f"{settings.API_V1_STR}/items/{item_a.id}",
        headers=user_b_headers,
        json={"title": "stolen"},
    )
    assert r.status_code == 404


def test_cross_tenant_item_delete_is_404(
    client: TestClient, user_b_headers: dict[str, str], item_a: Item
) -> None:
    r = client.delete(
        f"{settings.API_V1_STR}/items/{item_a.id}", headers=user_b_headers
    )
    assert r.status_code == 404


def test_cross_tenant_ocr_read_is_404(
    aux_client: TestClient, user_b_headers: dict[str, str], ocr_doc_a: OcrDocument
) -> None:
    r = aux_client.get(
        f"{settings.API_V1_STR}/ocr/{ocr_doc_a.id}", headers=user_b_headers
    )
    assert r.status_code == 404


def test_cross_tenant_ocr_delete_is_404(
    aux_client: TestClient, user_b_headers: dict[str, str], ocr_doc_a: OcrDocument
) -> None:
    r = aux_client.delete(
        f"{settings.API_V1_STR}/ocr/{ocr_doc_a.id}", headers=user_b_headers
    )
    assert r.status_code == 404


def test_cross_tenant_conversation_read_is_404(
    aux_client: TestClient,
    user_b_headers: dict[str, str],
    conversation_a: Conversation,
) -> None:
    r = aux_client.get(
        f"{settings.API_V1_STR}/chat/conversations/{conversation_a.id}",
        headers=user_b_headers,
    )
    assert r.status_code == 404


def test_cross_tenant_conversation_delete_is_404(
    aux_client: TestClient,
    user_b_headers: dict[str, str],
    conversation_a: Conversation,
) -> None:
    r = aux_client.delete(
        f"{settings.API_V1_STR}/chat/conversations/{conversation_a.id}",
        headers=user_b_headers,
    )
    assert r.status_code == 404


# --- list isolation


def test_item_list_is_tenant_isolated(
    client: TestClient, user_b_headers: dict[str, str], item_a: Item
) -> None:
    r = client.get(f"{settings.API_V1_STR}/items/", headers=user_b_headers)
    assert r.status_code == 200
    ids = [row["id"] for row in r.json()["data"]]
    assert str(item_a.id) not in ids


def test_ocr_list_is_tenant_isolated(
    aux_client: TestClient, user_b_headers: dict[str, str], ocr_doc_a: OcrDocument
) -> None:
    r = aux_client.get(f"{settings.API_V1_STR}/ocr/", headers=user_b_headers)
    assert r.status_code == 200
    ids = [row["id"] for row in r.json()["data"]]
    assert str(ocr_doc_a.id) not in ids


def test_conversation_list_is_tenant_isolated(
    aux_client: TestClient,
    user_b_headers: dict[str, str],
    conversation_a: Conversation,
) -> None:
    r = aux_client.get(
        f"{settings.API_V1_STR}/chat/conversations", headers=user_b_headers
    )
    assert r.status_code == 200
    ids = [row["id"] for row in r.json()["data"]]
    assert str(conversation_a.id) not in ids


# --- creates stamp tenant_id


def test_create_item_stamps_tenant(
    client: TestClient,
    db: Session,
    user_b_headers: dict[str, str],
    tenant_b: Tenant,
) -> None:
    r = client.post(
        f"{settings.API_V1_STR}/items/",
        headers=user_b_headers,
        json={"title": "b item"},
    )
    assert r.status_code == 200
    item = db.get(Item, uuid.UUID(r.json()["id"]))
    assert item is not None
    assert item.tenant_id == tenant_b.id


def test_create_conversation_stamps_tenant(
    aux_client: TestClient,
    db: Session,
    user_b_headers: dict[str, str],
    tenant_b: Tenant,
) -> None:
    r = aux_client.post(
        f"{settings.API_V1_STR}/chat/conversations",
        headers=user_b_headers,
        json={"title": "b conv"},
    )
    assert r.status_code == 200
    conv = db.get(Conversation, uuid.UUID(r.json()["id"]))
    assert conv is not None
    assert conv.tenant_id == tenant_b.id


def test_first_login_assigns_default_tenant(
    client: TestClient, db: Session, default_tenant: Tenant
) -> None:
    # Self-signup happens in Supabase; the local mirror row is
    # JIT-provisioned on the first authenticated request with the default
    # tenant — the current signup semantics, preserved.
    email = random_email()
    password = random_lower_string()
    supabase_auth.admin_get_or_create_user(email=email, password=password)
    r = client.get(
        f"{settings.API_V1_STR}/users/me",
        headers=user_authentication_headers(email=email, password=password),
    )
    assert r.status_code == 200
    assert r.json()["tenant_id"] == str(default_tenant.id)
    user = db.exec(select(User).where(User.email == email)).first()
    assert user is not None
    assert user.tenant_id == default_tenant.id


# --- superuser keeps cross-tenant (platform operator) access


def test_superuser_sees_items_across_tenants(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    item_a: Item,
    user_b_headers: dict[str, str],
) -> None:
    created = client.post(
        f"{settings.API_V1_STR}/items/",
        headers=user_b_headers,
        json={"title": "b item for superuser"},
    )
    assert created.status_code == 200
    r = client.get(
        f"{settings.API_V1_STR}/items/?limit=100", headers=superuser_token_headers
    )
    assert r.status_code == 200
    ids = [row["id"] for row in r.json()["data"]]
    assert str(item_a.id) in ids
    assert created.json()["id"] in ids


def test_superuser_reads_cross_tenant_item(
    client: TestClient, superuser_token_headers: dict[str, str], item_a: Item
) -> None:
    r = client.get(
        f"{settings.API_V1_STR}/items/{item_a.id}", headers=superuser_token_headers
    )
    assert r.status_code == 200
