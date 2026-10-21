"""Sync registrations for the weather module: the per-user preferences.
Forecasts are not synced; the device asks ``/weather/forecast``."""

import uuid

from pydantic import BaseModel

from app.modules.sync.registry import Entity, Registry
from app.modules.weather import services
from app.modules.weather.models import WeatherPref
from app.modules.weather.schema import WeatherPrefPublic, WeatherPrefUpdate
from app.shared import owned_repo
from app.shared.context import Ctx


def _upsert(ctx: Ctx, row_id: uuid.UUID, payload: BaseModel) -> WeatherPref:
    del row_id  # one row per user
    assert isinstance(payload, WeatherPrefUpdate)
    pref = services.get_prefs(ctx)
    owned_repo.apply(pref, payload.model_dump(exclude_unset=True))
    ctx.session.add(pref)
    ctx.session.flush()
    return pref


def register(r: Registry) -> None:
    r.entity(
        Entity(
            name="weather_pref",
            model=WeatherPref,
            payload=WeatherPrefUpdate,
            public=WeatherPrefPublic,
            upsert=_upsert,
        )
    )
