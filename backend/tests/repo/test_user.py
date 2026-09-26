from fastapi.encoders import jsonable_encoder
from sqlmodel import Session

from app.db.models import User
from app.modules.iam.users import repo as user_repo
from app.modules.iam.users.schema import UserCreate
from tests.utils.user import default_tenant_id
from tests.utils.utils import random_email


def _create_user(db: Session, user_in: UserCreate) -> User:
    """Helper to create a user from a UserCreate schema via the repo layer."""
    db_user = User.model_validate(user_in, update={"tenant_id": default_tenant_id(db)})
    return user_repo.create(session=db, user=db_user)


def test_create_user(db: Session) -> None:
    email = random_email()
    user_in = UserCreate(email=email)
    user = _create_user(db, user_in)
    assert user.email == email
    # Credentials live in Supabase Auth — no password material locally.
    assert not hasattr(user, "hashed_password")


def test_check_if_user_is_active(db: Session) -> None:
    user_in = UserCreate(email=random_email())
    user = _create_user(db, user_in)
    assert user.is_active is True


def test_check_if_user_is_active_inactive(db: Session) -> None:
    user_in = UserCreate(email=random_email(), is_active=False)
    user = _create_user(db, user_in)
    assert user.is_active is False


def test_check_if_user_is_superuser(db: Session) -> None:
    user_in = UserCreate(email=random_email(), is_superuser=True)
    user = _create_user(db, user_in)
    assert user.is_superuser is True


def test_check_if_user_is_superuser_normal_user(db: Session) -> None:
    user_in = UserCreate(email=random_email())
    user = _create_user(db, user_in)
    assert user.is_superuser is False


def test_get_user(db: Session) -> None:
    user_in = UserCreate(email=random_email(), is_superuser=True)
    user = _create_user(db, user_in)
    user_2 = user_repo.get_by_id(session=db, user_id=user.id)
    assert user_2
    assert user.email == user_2.email
    assert jsonable_encoder(user) == jsonable_encoder(user_2)


def test_update_user(db: Session) -> None:
    user_in = UserCreate(email=random_email(), is_superuser=True)
    user = _create_user(db, user_in)
    new_name = "updated-full-name"
    user_repo.update(session=db, user=user, update_data={"full_name": new_name})
    user_2 = user_repo.get_by_id(session=db, user_id=user.id)
    assert user_2
    assert user.email == user_2.email
    assert user_2.full_name == new_name
