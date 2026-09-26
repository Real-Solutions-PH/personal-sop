from sqlmodel import Session

from app.modules.iam.permissions import repo as permission_repo
from app.modules.iam.permissions.models import Permission

# (resource, action, description)
DEFAULT_PERMISSIONS: list[tuple[str, str, str]] = [
    ("users", "read", "Read user records"),
    ("users", "write", "Create or update user records"),
    ("users", "delete", "Delete user records"),
    ("items", "read", "Read items"),
    ("items", "write", "Create or update items"),
    ("items", "delete", "Delete items"),
    ("ocr", "read", "Read OCR documents"),
    ("ocr", "write", "Upload or delete OCR documents"),
    ("conversations", "read", "Read AI conversations"),
    ("conversations", "write", "Create or delete AI conversations"),
    ("roles", "read", "Read role definitions"),
    ("permissions", "read", "Read permission definitions"),
    ("tenants", "read", "Read tenant records"),
    ("audit", "read", "Read the audit log"),
    ("data", "export", "Export personal data (GDPR portability)"),
    ("data", "erase", "Erase personal data (GDPR right to erasure)"),
    # AI catalog (platform-global surface): mutating agents/tools and all MCP
    # access. Ordinary agent/tool reads stay open to any authenticated user.
    ("agents", "write", "Create, update or delete agent definitions"),
    ("tools", "write", "Create, update or delete tool definitions and assignments"),
    ("mcp", "read", "Read MCP server definitions"),
    ("mcp", "write", "Create, update or delete MCP server definitions"),
    # RBAC administration: assign roles and grant permissions.
    ("rbac", "manage", "Assign roles and grant permissions to users and roles"),
]


def seed_permissions(session: Session) -> None:
    for resource, action, description in DEFAULT_PERMISSIONS:
        name = f"{resource}:{action}"
        if permission_repo.get_by_name(session=session, name=name) is None:
            permission_repo.create(
                session=session,
                permission=Permission(
                    name=name,
                    resource=resource,
                    action=action,
                    description=description,
                ),
            )
