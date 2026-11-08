from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

UsageKind = Literal["app_open", "app_close", "share_card"]

MAX_BATCH = 50


class UsageEventIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    kind: UsageKind
    at: datetime
    # A card key from the app: lowercase letters, digits, "-" and "_".
    detail: str | None = Field(default=None, pattern=r"^[a-z0-9_-]{1,40}$")

    @model_validator(mode="after")
    def _shape(self) -> "UsageEventIn":
        if (self.kind == "share_card") != (self.detail is not None):
            raise ValueError("detail is required for share_card and only for it")
        if self.at.tzinfo is None:
            raise ValueError("at must carry a timezone")
        return self


class UsageBatch(BaseModel):
    model_config = ConfigDict(extra="forbid")

    events: list[UsageEventIn] = Field(min_length=1, max_length=MAX_BATCH)


class UsageAccepted(BaseModel):
    accepted: int
