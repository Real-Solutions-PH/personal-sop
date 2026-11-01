"""Workout kcal and steps; run sessions; logged focus sessions.

A workout carries its estimated active kcal and the steps taken (both
optional). ``run_session`` holds the finished runs and walks the phone
records: totals, the GPS route and per-kilometre splits. A focus session
records whether the timer ran it or it was logged afterwards (``source``),
and a logged one may carry its own ``label``; every existing session was
run by the timer, which the server default fills in.

Revision ID: f793f04838a4
Revises: 948e28489067
Create Date: 2026-11-01

"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "f793f04838a4"
down_revision = "948e28489067"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("workout", sa.Column("kcal", sa.Float(), nullable=True))
    op.add_column("workout", sa.Column("steps", sa.Integer(), nullable=True))
    op.create_check_constraint(
        "ck_workout_kcal", "workout", "kcal IS NULL OR (kcal >= 0 AND kcal <= 20000)"
    )
    op.create_check_constraint(
        "ck_workout_steps",
        "workout",
        "steps IS NULL OR (steps >= 0 AND steps <= 300000)",
    )

    op.add_column(
        "focus_session",
        sa.Column(
            "source", sa.String(length=6), server_default="timer", nullable=False
        ),
    )
    op.add_column(
        "focus_session", sa.Column("label", sa.String(length=80), nullable=True)
    )
    op.create_check_constraint(
        "ck_focus_session_source", "focus_session", "source IN ('timer', 'manual')"
    )

    op.create_table(
        "run_session",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("owner_id", sa.Uuid(), nullable=False),
        sa.Column("tenant_id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("version", sa.BigInteger(), server_default="0", nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("kind", sa.String(length=4), nullable=False),
        sa.Column("name", sa.String(length=80), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("ended_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("moving_sec", sa.Integer(), nullable=False),
        sa.Column("distance_m", sa.Float(), nullable=False),
        sa.Column("elevation_gain_m", sa.Float(), nullable=True),
        sa.Column("steps", sa.Integer(), nullable=True),
        sa.Column("avg_hr", sa.Integer(), nullable=True),
        sa.Column("max_hr", sa.Integer(), nullable=True),
        sa.Column("kcal", sa.Float(), nullable=True),
        sa.Column(
            "route",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'[]'::jsonb"),
            nullable=False,
        ),
        sa.Column(
            "splits",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'[]'::jsonb"),
            nullable=False,
        ),
        sa.Column("notes", sa.String(length=2000), nullable=True),
        sa.CheckConstraint("kind IN ('run', 'walk')", name="ck_run_session_kind"),
        sa.CheckConstraint("ended_at >= started_at", name="ck_run_session_end"),
        sa.CheckConstraint("moving_sec >= 0", name="ck_run_session_moving"),
        sa.CheckConstraint(
            "distance_m >= 0 AND distance_m <= 1000000",
            name="ck_run_session_distance",
        ),
        sa.CheckConstraint(
            "elevation_gain_m IS NULL OR elevation_gain_m >= 0",
            name="ck_run_session_elevation",
        ),
        sa.CheckConstraint(
            "steps IS NULL OR (steps >= 0 AND steps <= 300000)",
            name="ck_run_session_steps",
        ),
        sa.CheckConstraint(
            "(avg_hr IS NULL OR avg_hr BETWEEN 20 AND 250)"
            " AND (max_hr IS NULL OR max_hr BETWEEN 20 AND 250)",
            name="ck_run_session_hr",
        ),
        sa.CheckConstraint(
            "kcal IS NULL OR (kcal >= 0 AND kcal <= 20000)",
            name="ck_run_session_kcal",
        ),
        sa.ForeignKeyConstraint(["owner_id"], ["user.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenant.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    for column in ("deleted_at", "owner_id", "started_at", "tenant_id", "version"):
        op.create_index(op.f(f"ix_run_session_{column}"), "run_session", [column])
    op.create_index(
        "ix_run_session_owner_version", "run_session", ["owner_id", "version"]
    )
    op.execute(
        "CREATE TRIGGER run_session_sync_version BEFORE INSERT OR UPDATE"
        " ON run_session FOR EACH ROW EXECUTE FUNCTION set_sync_version()"
    )
    op.execute("ALTER TABLE run_session ENABLE ROW LEVEL SECURITY")
    op.execute(
        """
        CREATE POLICY run_session_tenant_isolation ON run_session
            USING (tenant_id = app_tenant_id())
            WITH CHECK (tenant_id = app_tenant_id())
        """
    )


def downgrade() -> None:
    op.drop_table("run_session")
    op.drop_constraint("ck_focus_session_source", "focus_session", type_="check")
    op.drop_column("focus_session", "label")
    op.drop_column("focus_session", "source")
    op.drop_constraint("ck_workout_steps", "workout", type_="check")
    op.drop_constraint("ck_workout_kcal", "workout", type_="check")
    op.drop_column("workout", "steps")
    op.drop_column("workout", "kcal")
