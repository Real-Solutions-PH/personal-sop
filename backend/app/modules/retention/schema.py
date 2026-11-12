from typing import Literal

from pydantic import BaseModel


class NudgeSettings(BaseModel):
    """What Settings shows for "Nudges from Fern"."""

    mode: Literal["daily", "weekly", "off"]
    # The time the person pinned (HH:MM), or null for the usual time.
    pinned: str | None
    # The usual time the nightly job found for today (HH:MM): just before
    # when they are most often in the app. Null until it first runs, or
    # when no time today is free of quiet hours and reminders.
    usual: str | None
