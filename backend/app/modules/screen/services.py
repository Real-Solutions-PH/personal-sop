"""Write use cases and reads of the screen module.

The phone is the only writer (through the sync engine): it creates and
edits groups and reports each group's lower bound per app day. Decisions
recorded here:

- A day row is keyed by ``(group, day)``: an upsert for a pair that already
  has a row lands on that row whatever id the device minted, keeps the higher
  ``used_min`` and stays closed once closed, so two devices or a replay can
  only raise it.
- Only the last week is accepted (``today - 7 … today`` in the person's
  business day): the phone reconciles the last seven app days, anything
  outside that window is a bug.
- A group a live habit's rule points at can be neither archived nor deleted
  (409 ``screen_group_in_use``, details: those habits); the person changes or
  archives the habits first.
- At most one live ``all`` group (a partial unique index) and
  :data:`~app.modules.screen.models.MAX_CUSTOM_GROUPS` live custom ones.
"""

import uuid
from datetime import date, timedelta
from typing import Any

from sqlmodel import col

from app.modules.screen.models import MAX_CUSTOM_GROUPS, ScreenDay, ScreenGroup
from app.modules.screen.schema import DaySyncIn, GroupSyncIn
from app.modules.stats import public as stats
from app.shared import owned_repo
from app.shared.context import Ctx
from app.shared.domain import conflict, invalid

MODULE = "screen"
DAYS_BACK = 7


def _dirty(ctx: Ctx, day: date) -> None:
    stats.mark_dirty(ctx, module=MODULE, day=day)


# ---------------------------------------------------------------- groups


def _require_unused(ctx: Ctx, group_id: uuid.UUID) -> None:
    from app.modules.habits import public as habits_public

    habits = habits_public.rule_habits(ctx, group_id=group_id)
    if habits:
        raise conflict(
            "screen_group_in_use",
            "Habits complete from this group: change or archive them first",
            [{"id": str(h.id), "name": h.name} for h in habits],
        )


def _require_room(ctx: Ctx, group_id: uuid.UUID) -> None:
    others = owned_repo.count_rows(
        ctx,
        ScreenGroup,
        col(ScreenGroup.kind) == "custom",
        col(ScreenGroup.archived_at).is_(None),
        col(ScreenGroup.id) != group_id,
    )
    if others >= MAX_CUSTOM_GROUPS:
        raise invalid(
            "screen_group_limit",
            f"You can track up to {MAX_CUSTOM_GROUPS} app groups",
        )


def upsert_group_sync(ctx: Ctx, row_id: uuid.UUID, payload: GroupSyncIn) -> ScreenGroup:
    data = payload.model_dump(exclude_unset=True)
    for key in ("name", "kind", "budget_min", "sort_order"):
        if key in data and data[key] is None:
            raise invalid("field_required", "That field can't be empty")
    existing = owned_repo.get(ctx, ScreenGroup, row_id, include_deleted=True)
    kind = data.get("kind") or (existing.kind if existing else "custom")
    archived = (
        data["archived_at"]
        if "archived_at" in data
        else (existing.archived_at if existing else None)
    )
    if existing is not None and existing.archived_at is None and archived is not None:
        _require_unused(ctx, row_id)
    if kind == "custom" and archived is None:
        _require_room(ctx, row_id)
    row, _ = owned_repo.upsert(ctx, ScreenGroup, row_id, data)
    _dirty(ctx, ctx.today)
    return row


def delete_group(ctx: Ctx, *, group_id: uuid.UUID) -> None:
    """Delete a group and its days; refused while a live rule points at it."""
    row = owned_repo.require(ctx, ScreenGroup, group_id, what="screen_group")
    _require_unused(ctx, group_id)
    for d in owned_repo.list_rows(ctx, ScreenDay, col(ScreenDay.group_id) == group_id):
        owned_repo.soft_delete(ctx, d)
        _dirty(ctx, d.day)
    owned_repo.soft_delete(ctx, row)
    _dirty(ctx, ctx.today)
    ctx.commit()


# ---------------------------------------------------------------- days


def upsert_day_sync(ctx: Ctx, row_id: uuid.UUID, payload: DaySyncIn) -> ScreenDay:
    data: dict[str, Any] = payload.model_dump(exclude_unset=True)
    for key in ("group_id", "day", "used_min", "closed"):
        if key in data and data[key] is None:
            raise invalid("field_required", "That field can't be empty")
    existing = owned_repo.get(ctx, ScreenDay, row_id, include_deleted=True)
    group_id = data.get("group_id") or (existing.group_id if existing else None)
    day = data.get("day") or (existing.day if existing else None)
    if group_id is None or day is None:
        raise invalid("missing_fields", "A screen-time day needs a group and a day")
    owned_repo.require(ctx, ScreenGroup, group_id, what="screen_group")
    if not ctx.today - timedelta(days=DAYS_BACK) <= day <= ctx.today:
        raise invalid(
            "screen_day_out_of_range",
            f"Screen time is accepted for the last {DAYS_BACK} days only",
        )
    data = {**data, "group_id": group_id, "day": day}
    current = existing or owned_repo.find_one(
        ctx,
        ScreenDay,
        col(ScreenDay.group_id) == group_id,
        col(ScreenDay.day) == day,
        include_deleted=True,
    )
    if current is not None and current.deleted_at is None:
        if "used_min" in data:
            data["used_min"] = max(current.used_min, data["used_min"])
        if "closed" in data:
            data["closed"] = current.closed or data["closed"]
    natural = ("group_id", "day") if existing is None else ()
    row, _ = owned_repo.upsert(ctx, ScreenDay, row_id, data, natural_key=natural)
    _dirty(ctx, day)
    return row


# ---------------------------------------------------------------- reads


def groups(ctx: Ctx) -> list[ScreenGroup]:
    """Every group that is not deleted, archived ones included (their past
    days still count)."""
    return owned_repo.list_rows(
        ctx, ScreenGroup, order_by=(col(ScreenGroup.sort_order),)
    )


def days(ctx: Ctx, first: date, last: date) -> list[ScreenDay]:
    return owned_repo.list_rows(
        ctx,
        ScreenDay,
        col(ScreenDay.day) >= first,
        col(ScreenDay.day) <= last,
        order_by=(col(ScreenDay.day),),
    )
