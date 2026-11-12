from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

# What the phone may send; purchased, cancelled and refunded come only from
# RevenueCat, through the server.
UsageKind = Literal[
    "app_open",
    "app_close",
    "share_card",
    "paywall_shown",
    "purchase_started",
    "restored",
    "push_open",
]

MAX_BATCH = 50


class UsageEventIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    kind: UsageKind
    at: datetime
    # A card key, a product id, or for push_open a notification id or a
    # reminder category, from the app: lowercase letters, digits, "-"
    # and "_".
    detail: str | None = Field(default=None, pattern=r"^[a-z0-9_-]{1,40}$")

    @model_validator(mode="after")
    def _shape(self) -> "UsageEventIn":
        if self.kind in ("share_card", "push_open") and self.detail is None:
            raise ValueError(f"detail is required for {self.kind}")
        if self.kind in ("app_open", "app_close") and self.detail is not None:
            raise ValueError("app_open and app_close carry no detail")
        if self.at.tzinfo is None:
            raise ValueError("at must carry a timezone")
        return self


class UsageBatch(BaseModel):
    model_config = ConfigDict(extra="forbid")

    events: list[UsageEventIn] = Field(min_length=1, max_length=MAX_BATCH)


class UsageAccepted(BaseModel):
    accepted: int
