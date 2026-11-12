import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

FunnelEventKind = Literal[
    "step_view",
    "step_complete",
    "step_skip",
    "module_toggle",
    "module_choice",
    "first_log",
]
FunnelStep = Literal[
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
    "tour_fern",
    "tour_tick",
    "tour_plan",
    "tour_stats",
    "tour_remind",
    "app",
]
FunnelModule = Literal[
    "habits",
    "tasks",
    "fitness",
    "nutrition",
    "focus",
    "finance",
    "screen",
    "journal",
    "social",
]

MAX_BATCH = 50


class FunnelEventIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    event: FunnelEventKind
    step: FunnelStep
    module: FunnelModule | None = None
    turned_on: bool | None = None
    at: datetime

    @model_validator(mode="after")
    def _shape(self) -> "FunnelEventIn":
        if self.event in ("module_toggle", "module_choice"):
            if self.module is None or self.turned_on is None:
                raise ValueError(f"{self.event} needs module and turned_on")
        elif self.turned_on is not None:
            raise ValueError("turned_on is for module_toggle and module_choice")
        if self.at.tzinfo is None:
            raise ValueError("at must carry a timezone")
        return self


class FunnelBatch(BaseModel):
    model_config = ConfigDict(extra="forbid")

    install_id: uuid.UUID
    events: list[FunnelEventIn] = Field(min_length=1, max_length=MAX_BATCH)


class FunnelAccepted(BaseModel):
    accepted: int
