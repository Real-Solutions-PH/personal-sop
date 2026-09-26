from sqlmodel import Session, select

from app.modules.iam.permissions.models import Permission
from app.modules.iam.rbac import repo as rbac_repo
from app.modules.iam.roles import repo as role_repo

# Role name -> permission names ("resource:action"). The literal "*" grants
# every seeded permission (used for the platform-wide superadmin role).
#
# The "dpo" (Data Protection Officer) role is a compliance role: read access to
# users + audit trail and the data export/erase rights, without the broad
# write/admin surface. It consumes the audit-log and GDPR-erase capabilities
# tracked separately.
ROLE_PERMISSIONS: dict[str, list[str]] = {
    "superadmin": ["*"],
    "admin": [
        "users:read",
        "users:write",
        "items:read",
        "items:write",
        "items:delete",
        "roles:read",
        "permissions:read",
        "tenants:read",
    ],
    "user": [
        "items:read",
        "items:write",
        "items:delete",
        "ocr:read",
        "ocr:write",
        "conversations:read",
        "conversations:write",
    ],
    "dpo": ["users:read", "audit:read", "data:export", "data:erase"],
}


def seed_role_permissions(session: Session) -> None:
    """Idempotently grant each seeded role its permission set.

    Must run after ``seed_roles`` and ``seed_permissions``. Only adds missing
    grants; never revokes, so operator-made grants survive re-seeding.
    """
    all_perms = list(session.exec(select(Permission)).all())
    by_name = {p.name: p for p in all_perms}

    for role_name, perm_names in ROLE_PERMISSIONS.items():
        role = role_repo.get_by_name(session=session, name=role_name)
        if role is None:
            continue
        granted = (
            all_perms
            if perm_names == ["*"]
            else [by_name[n] for n in perm_names if n in by_name]
        )
        for perm in granted:
            rbac_repo.add_permission_to_role(
                session=session, role_id=role.id, permission_id=perm.id
            )
