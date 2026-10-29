"""Sync registrations for the screen module.

Sync is the module's only write path: the phone owns the picked apps and the
DeviceActivity events, and writes groups and per-day lower bounds as rows.
Each upsert goes through the service, which holds the rules (the day range,
the ``(group, day)`` natural key that only ever raises a day, the group
limits and the archive guard).
"""

import uuid

from pydantic import BaseModel

from app.modules.screen import services as svc
from app.modules.screen.models import ScreenDay, ScreenGroup
from app.modules.screen.schema import DayPublic, DaySyncIn, GroupPublic, GroupSyncIn
from app.modules.sync.registry import Entity, Registry
from app.shared.context import Ctx
from app.shared.owned import OwnedRow


def _upsert_group(ctx: Ctx, row_id: uuid.UUID, payload: BaseModel) -> OwnedRow:
    assert isinstance(payload, GroupSyncIn)
    return svc.upsert_group_sync(ctx, row_id, payload)


def _delete_group(ctx: Ctx, row_id: uuid.UUID) -> None:
    svc.delete_group(ctx, group_id=row_id)


def _upsert_day(ctx: Ctx, row_id: uuid.UUID, payload: BaseModel) -> OwnedRow:
    assert isinstance(payload, DaySyncIn)
    return svc.upsert_day_sync(ctx, row_id, payload)


def register(r: Registry) -> None:
    r.entity(
        Entity(
            name="screen_group",
            model=ScreenGroup,
            payload=GroupSyncIn,
            public=GroupPublic,
            upsert=_upsert_group,
            delete=_delete_group,
            create_required=("name", "kind"),
        )
    )
    r.entity(
        Entity(
            name="screen_day",
            model=ScreenDay,
            payload=DaySyncIn,
            public=DayPublic,
            upsert=_upsert_day,
            create_required=("group_id", "day"),
        )
    )
