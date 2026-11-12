"""Onboarding funnel events: which steps a new person sees, finishes or skips,
and which modules they tick, so drop-off can be measured.

Most of onboarding happens before an account exists, so a row carries a
random per-install id generated on the phone, never a user id, name, email
or anything typed. Not tenant-scoped (there is no tenant before sign-up),
like ``auditlog``. Append-only by convention: the code only inserts.
"""

import uuid
from datetime import datetime

from sqlalchemy import CheckConstraint, String
from sqlmodel import Field, SQLModel

from app.shared.owned import enum_check, tstz, utcnow

EVENTS = (
    "step_view",
    "step_complete",
    "step_skip",
    "module_toggle",
    "module_choice",
    # The install's first log (a message to Fern, a tick, an entry), once.
    "first_log",
)
STEPS = (
    "welcome",
    "identity",
    "about",
    "modules",
    "capture",
    "targets",
    "when",
    "building",
    "pledge",
    "account",
    "notifications",
    "done",
    "setup",
    # The guided tour after onboarding.
    "tour_fern",
    "tour_tick",
    "tour_plan",
    "tour_stats",
    "tour_remind",
    # Anywhere in the app after onboarding (first_log only).
    "app",
)
# The scored modules plus the two extras onboarding offers.
MODULES = (
    "habits",
    "tasks",
    "fitness",
    "nutrition",
    "focus",
    "finance",
    "screen",
    "journal",
    "social",
)


class FunnelEvent(SQLModel, table=True):
    __tablename__ = "funnel_event"
    __table_args__ = (
        enum_check("event", EVENTS, name="ck_funnel_event_event"),
        enum_check("step", STEPS, name="ck_funnel_event_step"),
        CheckConstraint(
            f"module IS NULL OR module IN ({', '.join(repr(m) for m in MODULES)})",
            name="ck_funnel_event_module",
        ),
        CheckConstraint(
            "event NOT IN ('module_toggle', 'module_choice')"
            " OR (module IS NOT NULL AND turned_on IS NOT NULL)",
            name="ck_funnel_event_toggle",
        ),
    )

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    install_id: uuid.UUID = Field(index=True)
    event: str = Field(sa_type=String(16))  # type: ignore
    step: str = Field(sa_type=String(16))  # type: ignore
    # The module a setup step or a tick is about.
    module: str | None = Field(default=None, sa_type=String(16))  # type: ignore
    # module_toggle only: ticked (true) or unticked (false).
    turned_on: bool | None = None
    # When it happened on the phone, and when the server got it.
    at: datetime = Field(sa_type=tstz())  # type: ignore
    received_at: datetime = Field(default_factory=utcnow, sa_type=tstz())  # type: ignore
