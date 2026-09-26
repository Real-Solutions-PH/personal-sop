from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.core.config import settings
from app.db.models import User


def test_create_user(client: TestClient, db: Session) -> None:
    r = client.post(
        f"{settings.API_V1_STR}/private/users/",
        json={
            "email": "pollo@listo.com",
            "password": "password123",
            "full_name": "Pollo Listo",
        },
    )

    assert r.status_code == 200

    data = r.json()

    user = db.exec(select(User).where(User.id == data["id"])).first()

    assert user
    assert user.email == "pollo@listo.com"
    assert user.full_name == "Pollo Listo"


def test_create_user_is_idempotent(client: TestClient) -> None:
    # GoTrue users persist across test runs while local rows are wiped;
    # re-posting the same email must succeed and reuse the same auth UID.
    payload = {
        "email": "pollo@listo.com",
        "password": "password123",
        "full_name": "Pollo Listo",
    }
    r1 = client.post(f"{settings.API_V1_STR}/private/users/", json=payload)
    r2 = client.post(f"{settings.API_V1_STR}/private/users/", json=payload)
    assert r1.status_code == 200
    assert r2.status_code == 200
    assert r1.json()["id"] == r2.json()["id"]
