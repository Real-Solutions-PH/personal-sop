"""Sync payloads and public shapes of the screen module (never table models).

Every payload field is optional: a sync op carries only what changed
(field-level last-writer-wins); ``sync.py`` names the fields a create needs.
"""

import uuid
from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from app.modules.screen.models import NAME_MAX

GroupKind = Literal["all", "custom"]


class GroupSyncIn(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=NAME_MAX)
    kind: GroupKind | None = None
    budget_min: int | None = Field(default=None, ge=0, le=1440)
    sort_order: int | None = Field(default=None, ge=0, le=100000)
    archived_at: datetime | None = None


class GroupPublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    name: str
    kind: str
    budget_min: int
    sort_order: int
    archived_at: datetime | None
    created_at: datetime
    version: int


class DaySyncIn(BaseModel):
    group_id: uuid.UUID | None = None
    day: date | None = None
    used_min: int | None = Field(default=None, ge=0, le=1440)
    closed: bool | None = None


class DayPublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    group_id: uuid.UUID
    day: date
    used_min: int
    closed: bool
    updated_at: datetime
    version: int
