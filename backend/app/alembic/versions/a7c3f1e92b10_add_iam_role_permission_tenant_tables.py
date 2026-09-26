"""Add IAM role, permission, tenant tables

Revision ID: a7c3f1e92b10
Revises: fe56fa70289e
Create Date: 2026-04-18 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa
import sqlmodel.sql.sqltypes


# revision identifiers, used by Alembic.
revision = 'a7c3f1e92b10'
down_revision = 'fe56fa70289e'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'role',
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('name', sqlmodel.sql.sqltypes.AutoString(length=64), nullable=False),
        sa.Column('description', sqlmodel.sql.sqltypes.AutoString(length=255), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_role_name'), 'role', ['name'], unique=True)

    op.create_table(
        'permission',
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('name', sqlmodel.sql.sqltypes.AutoString(length=128), nullable=False),
        sa.Column('resource', sqlmodel.sql.sqltypes.AutoString(length=64), nullable=False),
        sa.Column('action', sqlmodel.sql.sqltypes.AutoString(length=32), nullable=False),
        sa.Column('description', sqlmodel.sql.sqltypes.AutoString(length=255), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_permission_name'), 'permission', ['name'], unique=True)
    op.create_index(op.f('ix_permission_resource'), 'permission', ['resource'], unique=False)

    op.create_table(
        'tenant',
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('name', sqlmodel.sql.sqltypes.AutoString(length=128), nullable=False),
        sa.Column('slug', sqlmodel.sql.sqltypes.AutoString(length=64), nullable=False),
        sa.Column('is_active', sa.Boolean(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_tenant_slug'), 'tenant', ['slug'], unique=True)


def downgrade():
    op.drop_index(op.f('ix_tenant_slug'), table_name='tenant')
    op.drop_table('tenant')
    op.drop_index(op.f('ix_permission_resource'), table_name='permission')
    op.drop_index(op.f('ix_permission_name'), table_name='permission')
    op.drop_table('permission')
    op.drop_index(op.f('ix_role_name'), table_name='role')
    op.drop_table('role')
