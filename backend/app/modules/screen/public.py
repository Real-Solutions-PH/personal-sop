"""Cross-module contract of the screen module: what habits (a habit's
screen-time rule) may call. None of these commit."""

import uuid

from sqlmodel import col

from app.modules.screen.models import ScreenGroup
from app.shared import owned_repo
from app.shared.context import Ctx
from app.shared.domain import not_found

RULE_KINDS = ("screen_limit",)
RULE_MAX_MIN = 1440


def require_live_group(ctx: Ctx, group_id: uuid.UUID) -> ScreenGroup:
    """The caller's group, not archived and not deleted (404 otherwise): the
    only kind a habit's rule may start pointing at."""
    row = owned_repo.find_one(
        ctx,
        ScreenGroup,
        col(ScreenGroup.id) == group_id,
        col(ScreenGroup.archived_at).is_(None),
    )
    if row is None:
        raise not_found("screen_group")
    return row
