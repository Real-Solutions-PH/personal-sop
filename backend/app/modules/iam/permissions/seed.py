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
    # Mobile API domain (owner-scoped; granted to the baseline user role).
    ("profile", "read", "Read the profile, preferences and Live bar"),
    ("profile", "write", "Change the profile, preferences and Live bar"),
    ("habits", "read", "Read habits and routines"),
    ("habits", "write", "Change habits and routines"),
    ("tasks", "read", "Read tasks and lists"),
    ("tasks", "write", "Change tasks and lists"),
    ("fitness", "read", "Read workouts, body and nutrition"),
    ("fitness", "write", "Change workouts, body and nutrition"),
    ("focus", "read", "Read focus sessions and goals"),
    ("focus", "write", "Change focus sessions and goals"),
    ("screen", "read", "Read screen-time groups and days"),
    ("screen", "write", "Change screen-time groups and days"),
    ("finance", "read", "Read accounts, records, budgets and plans"),
    ("finance", "write", "Change accounts, records, budgets and plans"),
    ("capture", "read", "Read captures, record cards and the journal"),
    ("capture", "write", "Change captures, record cards and the journal"),
    ("ai_providers", "read", "Read AI provider credentials and model choices"),
    ("ai_providers", "write", "Change AI provider credentials and model choices"),
    ("dashboard", "read", "Read goals, reviews, wrap-ups and the inbox"),
    ("dashboard", "write", "Change goals, reviews, wrap-ups and the inbox"),
    ("companion", "read", "Read the AI companion"),
    ("companion", "write", "Change the AI companion"),
    ("social", "read", "Read the social graph, posts, stories and chats"),
    ("social", "write", "Change the social graph, posts, stories and chats"),
    ("weather", "read", "Read weather preferences and forecasts"),
    ("weather", "write", "Change weather preferences and forecasts"),
    ("media", "read", "Read uploaded media"),
    ("media", "write", "Change uploaded media"),
    ("sync", "read", "Read the offline sync stream"),
    ("sync", "write", "Change the offline sync stream"),
    ("stats", "read", "Read statistics"),
    ("events", "read", "Receive the realtime event stream"),
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
