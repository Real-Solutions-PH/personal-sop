"""RBAC user_role and role_permission link tables

Revision ID: b2e7a1c94f30
Revises: f4b8c62d17a9
Create Date: 2026-07-13 00:00:00.000000

Hand-authored (autogenerate needs the DB up): adds the two link tables that
turn the existing (but inert) role/permission catalog into a working RBAC
system. Both tables are global reference/link data, not tenant-scoped, so no
RLS policies are attached (consistent with role/permission in a7c3f1e92b10).
"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'b2e7a1c94f30'
down_revision = 'f4b8c62d17a9'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'user_role',
        sa.Column('user_id', sa.Uuid(), nullable=False),
        sa.Column('role_id', sa.Uuid(), nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['user.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['role_id'], ['role.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('user_id', 'role_id'),
    )
    # Composite PK indexes user_id (leading); index role_id for reverse lookups
    # ("who has this role") and to back the ON DELETE CASCADE from role.
    op.create_index(
        op.f('ix_user_role_role_id'), 'user_role', ['role_id'], unique=False
    )

    op.create_table(
        'role_permission',
        sa.Column('role_id', sa.Uuid(), nullable=False),
        sa.Column('permission_id', sa.Uuid(), nullable=False),
        sa.ForeignKeyConstraint(['role_id'], ['role.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(
            ['permission_id'], ['permission.id'], ondelete='CASCADE'
        ),
        sa.PrimaryKeyConstraint('role_id', 'permission_id'),
    )
    op.create_index(
        op.f('ix_role_permission_permission_id'),
        'role_permission',
        ['permission_id'],
        unique=False,
    )


def downgrade():
    op.drop_index(
        op.f('ix_role_permission_permission_id'), table_name='role_permission'
    )
    op.drop_table('role_permission')
    op.drop_index(op.f('ix_user_role_role_id'), table_name='user_role')
    op.drop_table('user_role')
