"""Mobile API follow-ups from the module builds.

- ``category.sort_order``: categories are reorderable (FIN-13).
- ``fitness_settings.weigh_in_reminder``: a reminder TIME (HH:MM) or NULL
  for off, as the prototype stores it, instead of a boolean. Existing ``true``
  becomes the prototype default ``06:30``; ``false`` becomes NULL.
- ``look_back.period``: 24 characters, so a custom range key
  (``2026-09-01_2026-09-30``) fits.
- ``workout.cardio``: the cardio part of a workout logged from chat.

Revision ID: 6df6f75a2737
Revises: 536c41f13b56
Create Date: 2026-10-19 09:00:00.000000

"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = '6df6f75a2737'
down_revision = '536c41f13b56'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        'category',
        sa.Column('sort_order', sa.Integer(), server_default='0', nullable=False),
    )
    op.alter_column(
        'fitness_settings',
        'weigh_in_reminder',
        existing_type=sa.BOOLEAN(),
        type_=sa.String(length=5),
        nullable=True,
        postgresql_using="CASE WHEN weigh_in_reminder THEN '06:30' END",
    )
    op.alter_column(
        'look_back',
        'period',
        existing_type=sa.VARCHAR(length=16),
        type_=sa.String(length=24),
        existing_nullable=False,
    )
    op.add_column(
        'workout',
        sa.Column('cardio', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    )


def downgrade():
    op.drop_column('workout', 'cardio')
    # A custom-range key longer than 16 cannot survive the narrower column.
    op.execute("DELETE FROM look_back WHERE length(period) > 16")
    op.alter_column(
        'look_back',
        'period',
        existing_type=sa.String(length=24),
        type_=sa.VARCHAR(length=16),
        existing_nullable=False,
    )
    op.alter_column(
        'fitness_settings',
        'weigh_in_reminder',
        existing_type=sa.String(length=5),
        type_=sa.BOOLEAN(),
        nullable=False,
        postgresql_using="weigh_in_reminder IS NOT NULL",
    )
    op.drop_column('category', 'sort_order')
