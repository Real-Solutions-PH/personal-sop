"""funnel events

Revision ID: 16bb85411e8a
Revises: c3e7a1f05b92
Create Date: 2026-11-05 21:36:00.838507

Onboarding funnel events (step views, completions, skips and module ticks),
keyed by a random per-install id. Global like auditlog: there is no tenant
before sign-up.
"""

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "16bb85411e8a"
down_revision = "c3e7a1f05b92"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "funnel_event",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("install_id", sa.Uuid(), nullable=False),
        sa.Column("event", sa.String(length=16), nullable=False),
        sa.Column("step", sa.String(length=16), nullable=False),
        sa.Column("module", sa.String(length=16), nullable=True),
        sa.Column("turned_on", sa.Boolean(), nullable=True),
        sa.Column("at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("received_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "event NOT IN ('module_toggle', 'module_choice')"
            " OR (module IS NOT NULL AND turned_on IS NOT NULL)",
            name="ck_funnel_event_toggle",
        ),
        sa.CheckConstraint(
            "event IN ('step_view', 'step_complete', 'step_skip', 'module_toggle', 'module_choice')",
            name="ck_funnel_event_event",
        ),
        sa.CheckConstraint(
            "module IS NULL OR module IN ('habits', 'tasks', 'fitness', 'nutrition',"
            " 'focus', 'finance', 'screen', 'journal', 'social')",
            name="ck_funnel_event_module",
        ),
        sa.CheckConstraint(
            "step IN ('identity', 'about', 'modules', 'capture', 'targets', 'when',"
            " 'building', 'pledge', 'account', 'notifications', 'done', 'setup')",
            name="ck_funnel_event_step",
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_funnel_event_install_id"),
        "funnel_event",
        ["install_id"],
        unique=False,
    )


def downgrade():
    op.drop_index(op.f("ix_funnel_event_install_id"), table_name="funnel_event")
    op.drop_table("funnel_event")
