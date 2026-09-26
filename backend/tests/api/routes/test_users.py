import uuid

import httpx
import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.core import supabase_auth
from app.core.config import settings
from app.db.models import Item, User
from app.modules.iam.users import repo as user_repo
from app.modules.items import repo as item_repo
from tests.utils.user import create_auth_user, create_random_user
from tests.utils.utils import auth_headers, random_email


def _raise_connect_error(_user_id: uuid.UUID) -> None:
    """Stand-in for ``admin_delete_user`` that simulates GoTrue being
    unreachable — a subclass of ``httpx.HTTPError``."""
    raise httpx.ConnectError("gotrue unreachable")


def test_get_users_superuser_me(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    r = client.get(f"{settings.API_V1_STR}/users/me", headers=superuser_token_headers)
    current_user = r.json()
    assert current_user
    assert current_user["is_active"] is True
    assert current_user["is_superuser"]
    assert current_user["email"] == settings.FIRST_SUPERUSER


def test_get_users_normal_user_me(
    client: TestClient, normal_user_token_headers: dict[str, str]
) -> None:
    r = client.get(f"{settings.API_V1_STR}/users/me", headers=normal_user_token_headers)
    current_user = r.json()
    assert current_user
    assert current_user["is_active"] is True
    assert current_user["is_superuser"] is False
    assert current_user["email"] == settings.EMAIL_TEST_USER


def test_create_user_new_email(
    client: TestClient, superuser_token_headers: dict[str, str], db: Session
) -> None:
    username = random_email()
    r = client.post(
        f"{settings.API_V1_STR}/users/",
        headers=superuser_token_headers,
        json={"email": username},
    )
    assert 200 <= r.status_code < 300
    created_user = r.json()
    user = user_repo.get_by_email(session=db, email=username)
    assert user
    assert user.email == created_user["email"]
    # The local PK mirrors the Supabase auth UID created by the route.
    assert str(user.id) == created_user["id"]


def test_get_existing_user_as_superuser(
    client: TestClient, superuser_token_headers: dict[str, str], db: Session
) -> None:
    user = create_random_user(db)
    r = client.get(
        f"{settings.API_V1_STR}/users/{user.id}",
        headers=superuser_token_headers,
    )
    assert 200 <= r.status_code < 300
    api_user = r.json()
    existing_user = user_repo.get_by_email(session=db, email=user.email)
    assert existing_user
    assert existing_user.email == api_user["email"]


def test_get_non_existing_user_as_superuser(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    r = client.get(
        f"{settings.API_V1_STR}/users/{uuid.uuid4()}",
        headers=superuser_token_headers,
    )
    assert r.status_code == 404
    assert r.json() == {
        "code": "not_found",
        "message": "User not found",
        "details": None,
    }


def test_get_existing_user_current_user(client: TestClient, db: Session) -> None:
    user, password = create_auth_user(db)
    headers = auth_headers(user.email, password)

    r = client.get(
        f"{settings.API_V1_STR}/users/{user.id}",
        headers=headers,
    )
    assert 200 <= r.status_code < 300
    api_user = r.json()
    existing_user = user_repo.get_by_email(session=db, email=user.email)
    assert existing_user
    assert existing_user.email == api_user["email"]


def test_get_existing_user_permissions_error(
    db: Session,
    client: TestClient,
    normal_user_token_headers: dict[str, str],
) -> None:
    user = create_random_user(db)

    r = client.get(
        f"{settings.API_V1_STR}/users/{user.id}",
        headers=normal_user_token_headers,
    )
    assert r.status_code == 403
    assert r.json() == {
        "code": "forbidden",
        "message": "The user doesn't have enough privileges",
        "details": None,
    }


def test_get_non_existing_user_permissions_error(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
) -> None:
    user_id = uuid.uuid4()

    r = client.get(
        f"{settings.API_V1_STR}/users/{user_id}",
        headers=normal_user_token_headers,
    )
    assert r.status_code == 403
    assert r.json() == {
        "code": "forbidden",
        "message": "The user doesn't have enough privileges",
        "details": None,
    }


def test_create_user_existing_username(
    client: TestClient, superuser_token_headers: dict[str, str], db: Session
) -> None:
    user = create_random_user(db)
    r = client.post(
        f"{settings.API_V1_STR}/users/",
        headers=superuser_token_headers,
        json={"email": user.email},
    )
    created_user = r.json()
    assert r.status_code == 400
    assert "_id" not in created_user


def test_create_user_by_normal_user(
    client: TestClient, normal_user_token_headers: dict[str, str]
) -> None:
    r = client.post(
        f"{settings.API_V1_STR}/users/",
        headers=normal_user_token_headers,
        json={"email": random_email()},
    )
    assert r.status_code == 403


def test_retrieve_users(
    client: TestClient, superuser_token_headers: dict[str, str], db: Session
) -> None:
    create_random_user(db)
    create_random_user(db)

    r = client.get(f"{settings.API_V1_STR}/users/", headers=superuser_token_headers)
    all_users = r.json()

    assert len(all_users["data"]) > 1
    assert "count" in all_users
    for item in all_users["data"]:
        assert "email" in item


def test_update_user_me(client: TestClient, db: Session) -> None:
    user, password = create_auth_user(db)
    headers = auth_headers(user.email, password)

    full_name = "Updated Name"
    r = client.patch(
        f"{settings.API_V1_STR}/users/me",
        headers=headers,
        json={"full_name": full_name},
    )
    assert r.status_code == 200
    updated_user = r.json()
    assert updated_user["full_name"] == full_name
    assert updated_user["email"] == user.email  # email is not self-serviceable

    # The update happened in the app's session; drop this session's cached
    # instance (create_auth_user loaded it) before re-reading.
    db.expire_all()
    user_db = db.get(User, user.id)
    assert user_db
    assert user_db.full_name == full_name


def test_update_user_me_email_change_is_refused(
    client: TestClient, db: Session
) -> None:
    """Self-service email change is refused (returns 400) and applies nothing.

    The old path pushed the new address through the GoTrue admin API marked
    confirmed, so any authenticated user could claim an address they don't
    own — an account-takeover primitive.
    """
    user, password = create_auth_user(db)
    headers = auth_headers(user.email, password)

    r = client.patch(
        f"{settings.API_V1_STR}/users/me",
        headers=headers,
        json={"full_name": "should-not-apply", "email": random_email()},
    )
    assert r.status_code == 400
    assert "email" in r.json()["message"].lower()

    # The whole request is rejected before any write — full_name unchanged too.
    db.expire_all()
    user_db = db.get(User, user.id)
    assert user_db
    assert user_db.email == user.email
    assert user_db.full_name != "should-not-apply"


def test_update_user_me_same_email_is_noop(client: TestClient, db: Session) -> None:
    """Submitting the user's OWN current email is allowed (no-op), so a client
    that always sends the email field is not broken."""
    user, password = create_auth_user(db)
    headers = auth_headers(user.email, password)

    r = client.patch(
        f"{settings.API_V1_STR}/users/me",
        headers=headers,
        json={"full_name": "New Name", "email": user.email},
    )
    assert r.status_code == 200
    assert r.json()["full_name"] == "New Name"
    assert r.json()["email"] == user.email


def test_update_user(
    client: TestClient, superuser_token_headers: dict[str, str], db: Session
) -> None:
    user = create_random_user(db)

    data = {"full_name": "Updated_full_name"}
    r = client.patch(
        f"{settings.API_V1_STR}/users/{user.id}",
        headers=superuser_token_headers,
        json=data,
    )
    assert r.status_code == 200
    updated_user = r.json()

    assert updated_user["full_name"] == "Updated_full_name"

    user_query = select(User).where(User.email == user.email)
    user_db = db.exec(user_query).first()
    db.refresh(user_db)
    assert user_db
    assert user_db.full_name == "Updated_full_name"


def test_update_user_not_exists(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    data = {"full_name": "Updated_full_name"}
    r = client.patch(
        f"{settings.API_V1_STR}/users/{uuid.uuid4()}",
        headers=superuser_token_headers,
        json=data,
    )
    assert r.status_code == 404
    assert r.json()["message"] == "The user with this id does not exist in the system"


def test_update_user_email_exists(
    client: TestClient, superuser_token_headers: dict[str, str], db: Session
) -> None:
    user = create_random_user(db)
    user2 = create_random_user(db)

    data = {"email": user2.email}
    r = client.patch(
        f"{settings.API_V1_STR}/users/{user.id}",
        headers=superuser_token_headers,
        json=data,
    )
    assert r.status_code == 409
    assert r.json()["message"] == "User with this email already exists"


def test_delete_user_me(client: TestClient, db: Session) -> None:
    user, password = create_auth_user(db)
    user_id = user.id
    headers = auth_headers(user.email, password)

    r = client.delete(
        f"{settings.API_V1_STR}/users/me",
        headers=headers,
    )
    assert r.status_code == 200
    deleted_user = r.json()
    assert deleted_user["message"] == "User deleted successfully"
    result = db.exec(select(User).where(User.id == user_id)).first()
    assert result is None


def test_delete_user_me_gotrue_failure_is_noop(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    """If revoking the GoTrue identity fails, the local user row and its
    items must survive: deletion is atomic-or-nothing across both stores."""
    user, password = create_auth_user(db)
    user_id = user.id
    headers = auth_headers(user.email, password)
    item = item_repo.create(
        session=db,
        item=Item(title="keep me", owner_id=user.id, tenant_id=user.tenant_id),
    )
    item_id = item.id

    monkeypatch.setattr(supabase_auth, "admin_delete_user", _raise_connect_error)

    r = client.delete(f"{settings.API_V1_STR}/users/me", headers=headers)
    assert r.status_code == 502
    assert r.json()["code"] == "bad_gateway"

    db.expire_all()
    assert db.exec(select(User).where(User.id == user_id)).first() is not None
    assert db.exec(select(Item).where(Item.id == item_id)).first() is not None


def test_delete_user_me_as_superuser(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    r = client.delete(
        f"{settings.API_V1_STR}/users/me",
        headers=superuser_token_headers,
    )
    assert r.status_code == 403
    response = r.json()
    assert response["message"] == "Super users are not allowed to delete themselves"


def test_delete_user_super_user(
    client: TestClient, superuser_token_headers: dict[str, str], db: Session
) -> None:
    user = create_random_user(db)
    user_id = user.id
    r = client.delete(
        f"{settings.API_V1_STR}/users/{user_id}",
        headers=superuser_token_headers,
    )
    assert r.status_code == 200
    deleted_user = r.json()
    assert deleted_user["message"] == "User deleted successfully"
    result = db.exec(select(User).where(User.id == user_id)).first()
    assert result is None


def test_delete_user_gotrue_failure_is_noop(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    db: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Admin delete of another user is also atomic-or-nothing: a GoTrue
    failure leaves the target row and its items intact."""
    user = create_random_user(db)
    user_id = user.id
    item = item_repo.create(
        session=db,
        item=Item(title="keep me", owner_id=user.id, tenant_id=user.tenant_id),
    )
    item_id = item.id

    monkeypatch.setattr(supabase_auth, "admin_delete_user", _raise_connect_error)

    r = client.delete(
        f"{settings.API_V1_STR}/users/{user_id}",
        headers=superuser_token_headers,
    )
    assert r.status_code == 502
    assert r.json()["code"] == "bad_gateway"

    db.expire_all()
    assert db.exec(select(User).where(User.id == user_id)).first() is not None
    assert db.exec(select(Item).where(Item.id == item_id)).first() is not None


def test_delete_user_not_found(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    r = client.delete(
        f"{settings.API_V1_STR}/users/{uuid.uuid4()}",
        headers=superuser_token_headers,
    )
    assert r.status_code == 404
    assert r.json()["message"] == "User not found"


def test_delete_user_current_super_user_error(
    client: TestClient, superuser_token_headers: dict[str, str], db: Session
) -> None:
    super_user = user_repo.get_by_email(session=db, email=settings.FIRST_SUPERUSER)
    assert super_user
    user_id = super_user.id

    r = client.delete(
        f"{settings.API_V1_STR}/users/{user_id}",
        headers=superuser_token_headers,
    )
    assert r.status_code == 403
    assert r.json()["message"] == "Super users are not allowed to delete themselves"


def test_delete_user_without_privileges(
    client: TestClient, normal_user_token_headers: dict[str, str], db: Session
) -> None:
    user = create_random_user(db)

    r = client.delete(
        f"{settings.API_V1_STR}/users/{user.id}",
        headers=normal_user_token_headers,
    )
    assert r.status_code == 403
    assert r.json()["message"] == "The user doesn't have enough privileges"
