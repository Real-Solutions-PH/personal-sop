"""add fk indexes on hot per-user columns

Revision ID: df276405dedc
Revises: b2e7a1c94f30
Create Date: 2026-07-14 16:49:26.611096

"""
from alembic import op
import sqlalchemy as sa
import sqlmodel.sql.sqltypes


# revision identifiers, used by Alembic.
revision = 'df276405dedc'
down_revision = 'b2e7a1c94f30'
branch_labels = None
depends_on = None


def upgrade():
    # B-tree indexes on hot per-user FK filter columns (also back ON DELETE
    # CASCADE / SET NULL). See ticket #75.
    op.create_index(op.f('ix_item_owner_id'), 'item', ['owner_id'], unique=False)
    op.create_index(
        op.f('ix_conversation_user_id'), 'conversation', ['user_id'], unique=False
    )
    op.create_index(
        op.f('ix_conversation_agent_id'), 'conversation', ['agent_id'], unique=False
    )
    op.create_index(
        op.f('ix_message_conversation_id'), 'message', ['conversation_id'], unique=False
    )
    op.create_index(
        op.f('ix_ocr_document_owner_id'), 'ocr_document', ['owner_id'], unique=False
    )


def downgrade():
    op.drop_index(op.f('ix_ocr_document_owner_id'), table_name='ocr_document')
    op.drop_index(op.f('ix_message_conversation_id'), table_name='message')
    op.drop_index(op.f('ix_conversation_agent_id'), table_name='conversation')
    op.drop_index(op.f('ix_conversation_user_id'), table_name='conversation')
    op.drop_index(op.f('ix_item_owner_id'), table_name='item')
