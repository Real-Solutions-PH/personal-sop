from typing import Any

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from pydantic.networks import EmailStr

from app.core import supabase_auth
from app.modules.iam.deps import get_current_active_superuser
from app.modules.iam.tenants import services as tenant_service
from app.modules.iam.users import repo as user_repo
from app.modules.iam.users import services as user_service
from app.modules.iam.users.models import User
from app.modules.iam.users.schema import UserPublic
from app.shared.deps import SessionDep
from app.shared.schema import Message
from app.shared.utils.email import generate_test_email, send_email

utils_router = APIRouter(prefix="/utils", tags=["utils"])


@utils_router.post(
    "/test-email/",
    dependencies=[Depends(get_current_active_superuser)],
    status_code=201,
)
def test_email(email_to: EmailStr) -> Message:
    email_data = generate_test_email(email_to=email_to)
    send_email(
        email_to=email_to,
        subject=email_data.subject,
        html_content=email_data.html_content,
    )
    return Message(message="Test email sent")


@utils_router.get("/health-check/")
async def health_check() -> bool:
    return True


private_router = APIRouter(tags=["private"], prefix="/private")


class PrivateUserCreate(BaseModel):
    email: str
    password: str
    full_name: str
    is_verified: bool = False


@private_router.post("/users/", response_model=UserPublic)
def create_user(user_in: PrivateUserCreate, session: SessionDep) -> Any:
    # Local-env helper: create the GoTrue auth user (idempotently, password
    # reset to the given one) and mirror it locally under the auth UID.
    auth_uid = supabase_auth.admin_get_or_create_user(
        email=user_in.email, password=user_in.password
    )
    existing = user_repo.get_by_id(session=session, user_id=auth_uid)
    if existing:
        return existing
    user = User(
        id=auth_uid,
        email=user_in.email,
        full_name=user_in.full_name,
        tenant_id=tenant_service.get_default_tenant(session=session).id,
    )
    user = user_repo.create(session=session, user=user)
    # Mirror JIT provisioning: a created human account holds the baseline role,
    # or it is refused at the owner-resource permission gates.
    user_service.assign_default_role(session=session, user_id=user.id)
    return user
