"""Cross-module contract of the realtime module."""

import uuid

from app.modules.realtime import presence


def is_live(user_id: uuid.UUID) -> bool:
    """Whether the user has an open ``GET /events/stream`` right now."""
    return presence.is_live(user_id)
