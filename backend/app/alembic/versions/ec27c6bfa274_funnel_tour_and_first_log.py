"""funnel: tour steps and first_log

Revision ID: ec27c6bfa274
Revises: 5cf0aa4a327d
Create Date: 2026-11-12 12:00:00.000000

The funnel gains the Welcome screen, the five guided-tour steps and "app"
(anywhere after onboarding) as steps, and ``first_log`` as an event: this
install's first log, once, so time from first open to first log can be read
(KPI 6). Rewrites the two CHECKs; no data changes on the way up.
"""

from alembic import op

# revision identifiers, used by Alembic.
revision = "ec27c6bfa274"
down_revision = "5cf0aa4a327d"
branch_labels = None
depends_on = None

OLD_EVENTS = (
    "event IN ('step_view', 'step_complete', 'step_skip', 'module_toggle',"
    " 'module_choice')"
)
NEW_EVENTS = (
    "event IN ('step_view', 'step_complete', 'step_skip', 'module_toggle',"
    " 'module_choice', 'first_log')"
)
OLD_STEPS = (
    "step IN ('identity', 'about', 'modules', 'capture', 'targets', 'when',"
    " 'building', 'pledge', 'account', 'notifications', 'done', 'setup')"
)
NEW_STEPS = (
    "step IN ('welcome', 'identity', 'about', 'modules', 'capture', 'targets',"
    " 'when', 'building', 'pledge', 'account', 'notifications', 'done', 'setup',"
    " 'tour_fern', 'tour_tick', 'tour_plan', 'tour_stats', 'tour_remind', 'app')"
)


def upgrade() -> None:
    op.drop_constraint("ck_funnel_event_event", "funnel_event", type_="check")
    op.create_check_constraint("ck_funnel_event_event", "funnel_event", NEW_EVENTS)
    op.drop_constraint("ck_funnel_event_step", "funnel_event", type_="check")
    op.create_check_constraint("ck_funnel_event_step", "funnel_event", NEW_STEPS)


def downgrade() -> None:
    # Rows the old vocabulary cannot hold go with it.
    op.execute(
        "DELETE FROM funnel_event WHERE event = 'first_log' OR step IN"
        " ('welcome', 'tour_fern', 'tour_tick', 'tour_plan', 'tour_stats',"
        " 'tour_remind', 'app')"
    )
    op.drop_constraint("ck_funnel_event_step", "funnel_event", type_="check")
    op.create_check_constraint("ck_funnel_event_step", "funnel_event", OLD_STEPS)
    op.drop_constraint("ck_funnel_event_event", "funnel_event", type_="check")
    op.create_check_constraint("ck_funnel_event_event", "funnel_event", OLD_EVENTS)
