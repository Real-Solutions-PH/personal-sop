"""Cross-module contract of the dashboard module (implemented by dashboard)."""

import uuid
from typing import Literal

from app.modules.dashboard.models import Notification
from app.shared.context import Ctx

NotifKind = Literal["reminder", "achievement", "review", "system", "social"]


def notify(
    ctx: Ctx,
    *,
    kind: NotifKind,
    title: str,
    body: str = "",
    href: str = "/today",
    dedupe_key: str | None = None,
    push: bool = False,
    recipient_id: uuid.UUID | None = None,
) -> Notification | None:
    """Post to the inbox (and optionally push). Returns None when
    ``dedupe_key`` already exists for the recipient."""
    raise NotImplementedError
