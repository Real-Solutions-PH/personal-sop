from sqlmodel import Session

from app.modules.iam.roles import repo as role_repo
from app.modules.iam.roles.models import Role

DEFAULT_ROLES: list[dict[str, str]] = [
    {"name": "superadmin", "description": "Full system access"},
    {"name": "admin", "description": "Administrative access within a tenant"},
    {"name": "user", "description": "Standard authenticated user"},
    {
        "name": "dpo",
        "description": "Data Protection Officer: audit + data export/erase, no admin",
    },
]


def seed_roles(session: Session) -> None:
    for entry in DEFAULT_ROLES:
        if role_repo.get_by_name(session=session, name=entry["name"]) is None:
            role_repo.create(session=session, role=Role(**entry))
