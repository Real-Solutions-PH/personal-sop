import uuid
from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class ScheduleOverridePublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    version: int
    updated_at: datetime
    kind: str
    ref_id: uuid.UUID
    day: date
    time: str


class ScheduleOverrideIn(BaseModel):
    kind: Literal["habit", "routine", "task"] | None = None
    ref_id: uuid.UUID | None = None
    day: date | None = None
    time: str | None = Field(default=None, pattern=r"^([01]\d|2[0-3]):[0-5]\d$")
