import re
import uuid
from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.shared.day import check_timezone, parse_hm

ModuleKey = Literal["habits", "tasks", "fitness", "finance"]
Appearance = Literal["system", "light", "dark"]
PushPermission = Literal["default", "granted", "denied"]

HANDLE_RE = re.compile(r"^[a-z0-9._]{3,20}$")
# Never assignable: product and staff-looking names.
RESERVED_HANDLES = frozenset(
    {"admin", "root", "support", "help", "sol", "personal.sop", "sop", "system", "me"}
)


def check_handle(value: str | None) -> str | None:
    if value is not None and not HANDLE_RE.fullmatch(value):
        raise ValueError("3-20 lowercase letters, numbers, dots or underscores")
    return value


def _hm(value: str | None) -> str | None:
    if value is not None:
        parse_hm(value)
    return value


class ProfilePublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    handle: str | None
    photo_media_id: uuid.UUID | None
    since: date | None
    timezone: str
    day_start_hour: int
    evening_start: str
    target_threshold: float
    appearance: Appearance
    privacy_hidden: bool
    onboarded: bool
    setup_hidden: bool
    install_dismissed: bool
    push_permission: PushPermission
    push_morning: str | None
    push_evening: str | None
    push_review: bool
    seen_trophies: list[str]
    version: int
    updated_at: datetime


class ProfileUpdate(BaseModel):
    """Every field optional: also the sync payload (field-level LWW)."""

    name: str | None = Field(default=None, min_length=2, max_length=80)
    handle: str | None = None
    photo_media_id: uuid.UUID | None = None
    timezone: str | None = Field(default=None, max_length=64)
    day_start_hour: int | None = Field(default=None, ge=0, le=23)
    evening_start: str | None = None
    target_threshold: float | None = Field(default=None, gt=0, le=1)
    appearance: Appearance | None = None
    privacy_hidden: bool | None = None
    onboarded: bool | None = None
    setup_hidden: bool | None = None
    install_dismissed: bool | None = None
    push_permission: PushPermission | None = None
    push_morning: str | None = None
    push_evening: str | None = None
    push_review: bool | None = None
    seen_trophies: list[str] | None = Field(default=None, max_length=500)

    @field_validator("evening_start", "push_morning", "push_evening")
    @classmethod
    def _hms(cls, v: str | None) -> str | None:
        return _hm(v)

    @field_validator("handle")
    @classmethod
    def _handle(cls, v: str | None) -> str | None:
        return check_handle(v)

    @field_validator("timezone")
    @classmethod
    def _tz(cls, v: str | None) -> str | None:
        return None if v is None else check_timezone(v)


class CompleteSignup(BaseModel):
    name: str = Field(min_length=2, max_length=80)
    handle: str
    timezone: str | None = None

    @field_validator("handle")
    @classmethod
    def _handle(cls, v: str) -> str:
        check_handle(v)
        return v


class HandleCheck(BaseModel):
    handle: str
    status: Literal["available", "taken", "invalid"]
    reason: str | None = None


class HandleAvailability(BaseModel):
    """Sign-up's check, made before any account exists: the verdict only —
    never the handle back, and nothing about the account holding it."""

    status: Literal["available", "taken", "invalid"]


class ModulePrefPublic(BaseModel):
    module: ModuleKey
    enabled: bool
    weight: int


class ModulePrefUpdate(BaseModel):
    enabled: bool | None = None
    weight: int | None = Field(default=None, ge=0, le=10)


class ModulePrefSync(ModulePrefUpdate):
    module: ModuleKey | None = None


class ModulePrefRow(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    module: ModuleKey
    enabled: bool
    weight: int
    version: int


class IdentityIn(BaseModel):
    id: uuid.UUID | None = None
    text: str = Field(min_length=1, max_length=140)
    goal_id: uuid.UUID | None = None


class IdentitySync(BaseModel):
    text: str | None = Field(default=None, min_length=1, max_length=140)
    goal_id: uuid.UUID | None = None
    sort_order: int | None = Field(default=None, ge=0, le=2)


class IdentityPublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    text: str
    goal_id: uuid.UUID | None
    sort_order: int
    version: int


class SetupSkipPublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    module: ModuleKey
    version: int


class SetupSkipSync(BaseModel):
    module: ModuleKey | None = None


class LivePublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    kind: Literal["timer", "routine", "workout"]
    label: str
    href: str
    ref_id: uuid.UUID | None
    started_at: datetime
    paused_at: datetime | None
    paused_sec: int


class LiveState(BaseModel):
    live: LivePublic | None


class PushDeviceIn(BaseModel):
    token: str = Field(min_length=10, max_length=255)
    platform: Literal["ios", "android", "web"]

    @field_validator("token")
    @classmethod
    def _expo(cls, v: str) -> str:
        if not (v.startswith("ExponentPushToken[") or v.startswith("ExpoPushToken[")):
            raise ValueError("not an Expo push token")
        return v


class PushDevicePublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    platform: str
    last_seen_at: datetime | None
    disabled_at: datetime | None


class MeBundle(BaseModel):
    """Everything the Me / Settings screens need in one read."""

    profile: ProfilePublic
    modules: list[ModulePrefPublic]
    identities: list[IdentityPublic]
    setup_skipped: list[ModuleKey]
    live: LivePublic | None
