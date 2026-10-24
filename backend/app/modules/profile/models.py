"""Profile, preferences and device state — the mobile app's ``dash`` profile,
``auth-session`` completion, appearance, privacy and the global Live bar."""

import uuid
from datetime import date, datetime

from sqlalchemy import CheckConstraint, Float, Integer, String, UniqueConstraint
from sqlmodel import Field

from app.shared.currency import CODES
from app.shared.owned import JSONB, OwnedRow, enum_check, tstz

MODULE_KEYS = ("habits", "tasks", "fitness", "nutrition", "focus", "finance")
LIVE_KINDS = ("timer", "routine", "workout")
PUSH_PERMISSIONS = ("default", "granted", "denied")
APPEARANCE = ("system", "light", "dark")


class UserProfile(OwnedRow, table=True):
    """One row per user (``owner_id`` unique). The day clock lives here."""

    __tablename__ = "user_profile"
    __table_args__ = (
        UniqueConstraint("owner_id", name="uq_user_profile_owner"),
        UniqueConstraint("tenant_id", "handle", name="uq_user_profile_handle"),
        CheckConstraint(
            "day_start_hour BETWEEN 0 AND 23", name="ck_user_profile_day_start"
        ),
        CheckConstraint(
            "target_threshold > 0 AND target_threshold <= 1",
            name="ck_user_profile_threshold",
        ),
        enum_check("appearance", APPEARANCE, name="ck_user_profile_appearance"),
        enum_check(
            "push_permission", PUSH_PERMISSIONS, name="ck_user_profile_push_perm"
        ),
        enum_check("currency", CODES, name="ck_user_profile_currency"),
    )

    name: str = Field(default="", max_length=80)
    handle: str | None = Field(default=None, max_length=30)
    photo_media_id: uuid.UUID | None = Field(
        default=None, foreign_key="media_object.id", ondelete="SET NULL"
    )
    since: date | None = None
    timezone: str = Field(default="Asia/Manila", max_length=64)
    # ISO 4217 code (app.shared.currency); amounts are hundredths of it.
    currency: str = Field(
        default="PHP",
        sa_type=String(3),  # type: ignore
        sa_column_kwargs={"server_default": "PHP"},
    )
    day_start_hour: int = Field(default=4, sa_type=Integer)
    evening_start: str = Field(default="18:00", max_length=5)
    target_threshold: float = Field(default=0.8, sa_type=Float)
    appearance: str = Field(default="system", sa_type=String(8))  # type: ignore
    privacy_hidden: bool = False
    onboarded: bool = False
    setup_hidden: bool = False
    install_dismissed: bool = False
    push_permission: str = Field(default="default", sa_type=String(8))  # type: ignore
    push_morning: str | None = Field(default="07:00", max_length=5)
    push_evening: str | None = Field(default="21:00", max_length=5)
    push_review: bool = True
    seen_trophies: list[str] = Field(
        default_factory=list,
        sa_type=JSONB,
    )


class ModulePref(OwnedRow, table=True):
    """Per-module switch and Life Score weight."""

    __tablename__ = "module_pref"
    __table_args__ = (
        UniqueConstraint("owner_id", "module", name="uq_module_pref"),
        enum_check("module", MODULE_KEYS, name="ck_module_pref_module"),
        CheckConstraint("weight BETWEEN 0 AND 10", name="ck_module_pref_weight"),
    )

    module: str = Field(sa_type=String(16))  # type: ignore
    enabled: bool = True
    weight: int = Field(default=1, sa_type=Integer)


class Identity(OwnedRow, table=True):
    """Up to three identity statements, each optionally tied to a goal."""

    __tablename__ = "identity"

    text: str = Field(max_length=140)
    goal_id: uuid.UUID | None = Field(
        default=None, foreign_key="goal.id", ondelete="SET NULL"
    )
    sort_order: int = 0


class SetupSkip(OwnedRow, table=True):
    __tablename__ = "setup_skip"
    __table_args__ = (
        UniqueConstraint("owner_id", "module", name="uq_setup_skip"),
        enum_check("module", MODULE_KEYS, name="ck_setup_skip_module"),
    )

    module: str = Field(sa_type=String(16))  # type: ignore


class LiveSession(OwnedRow, table=True):
    """The one thing running right now (habit timer, routine, workout).

    One row per user at most (IA ruling X-2); starting another asks the user
    to finish or pause the current one, so the service refuses a second.
    """

    __tablename__ = "live_session"
    __table_args__ = (
        UniqueConstraint("owner_id", name="uq_live_session_owner"),
        enum_check("kind", LIVE_KINDS, name="ck_live_session_kind"),
    )

    kind: str = Field(sa_type=String(8))  # type: ignore
    label: str = Field(max_length=120)
    href: str = Field(max_length=255)
    ref_id: uuid.UUID | None = None
    started_at: datetime = Field(sa_type=tstz())  # type: ignore
    paused_at: datetime | None = Field(default=None, sa_type=tstz())  # type: ignore
    paused_sec: int = 0


class PushDevice(OwnedRow, table=True):
    """An Expo push token for one installation."""

    __tablename__ = "push_device"
    __table_args__ = (
        UniqueConstraint("token", name="uq_push_device_token"),
        enum_check("platform", ("ios", "android", "web"), name="ck_push_platform"),
    )

    token: str = Field(max_length=255)
    platform: str = Field(sa_type=String(8))  # type: ignore
    last_seen_at: datetime | None = Field(default=None, sa_type=tstz())  # type: ignore
    disabled_at: datetime | None = Field(default=None, sa_type=tstz())  # type: ignore
