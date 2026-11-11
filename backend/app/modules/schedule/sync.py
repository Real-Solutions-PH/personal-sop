"""Sync registration for schedule overrides: plain rows, reset = delete."""

import uuid

from pydantic import BaseModel

from app.modules.schedule import services
from app.modules.schedule.models import ScheduleOverride
from app.modules.schedule.schema import ScheduleOverrideIn, ScheduleOverridePublic
from app.modules.sync.registry import Entity, Registry
from app.shared.context import Ctx
from app.shared.owned import OwnedRow


def _upsert(ctx: Ctx, row_id: uuid.UUID, payload: BaseModel) -> OwnedRow:
    assert isinstance(payload, ScheduleOverrideIn)
    return services.upsert(ctx, row_id, payload.model_dump(exclude_unset=True))


def register(r: Registry) -> None:
    r.entity(
        Entity(
            name="schedule_override",
            model=ScheduleOverride,
            payload=ScheduleOverrideIn,
            public=ScheduleOverridePublic,
            upsert=_upsert,
            create_required=("kind", "ref_id", "day", "time"),
        )
    )
