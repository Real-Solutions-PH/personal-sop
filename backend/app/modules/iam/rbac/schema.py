from sqlmodel import SQLModel

from app.modules.iam.permissions.schema import PermissionPublic
from app.modules.iam.roles.schema import RolePublic


class UserPermissions(SQLModel):
    """A user's effective roles and the permissions they grant."""

    roles: list[RolePublic]
    permissions: list[PermissionPublic]


class RolePermissionsPublic(SQLModel):
    data: list[PermissionPublic]
    count: int
