import uuid

from sqlmodel import Field, SQLModel


class UserRole(SQLModel, table=True):
    """Assigns a role to a user (many-to-many)."""

    __tablename__ = "user_role"

    user_id: uuid.UUID = Field(
        foreign_key="user.id", primary_key=True, ondelete="CASCADE"
    )
    role_id: uuid.UUID = Field(
        foreign_key="role.id", primary_key=True, ondelete="CASCADE", index=True
    )


class RolePermission(SQLModel, table=True):
    """Grants a permission to a role (many-to-many)."""

    __tablename__ = "role_permission"

    role_id: uuid.UUID = Field(
        foreign_key="role.id", primary_key=True, ondelete="CASCADE"
    )
    permission_id: uuid.UUID = Field(
        foreign_key="permission.id", primary_key=True, ondelete="CASCADE", index=True
    )
