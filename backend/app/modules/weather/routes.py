from fastapi import APIRouter, Depends, Query

from app.modules.iam.deps import require_permission
from app.modules.weather import services
from app.modules.weather.schema import (
    PlacePublic,
    WeatherPrefPublic,
    WeatherPrefUpdate,
    WeatherView,
)
from app.shared.context import CtxDep
from app.shared.rate_limit import rate_limited

router = APIRouter(prefix="/weather", tags=["weather"])

READ = [Depends(require_permission("weather:read"))]
WRITE = [rate_limited("weather"), Depends(require_permission("weather:write"))]


@router.get("/prefs", response_model=WeatherPrefPublic, dependencies=READ)
def read_prefs(ctx: CtxDep) -> WeatherPrefPublic:
    return WeatherPrefPublic.model_validate(services.read_prefs(ctx))


@router.patch("/prefs", response_model=WeatherPrefPublic, dependencies=WRITE)
def update_prefs(ctx: CtxDep, body: WeatherPrefUpdate) -> WeatherPrefPublic:
    return WeatherPrefPublic.model_validate(services.update_prefs(ctx, body))


@router.get(
    "/forecast",
    response_model=WeatherView,
    dependencies=[*READ, rate_limited("weather-forecast")],
)
def read_forecast(
    ctx: CtxDep,
    lat: float | None = Query(default=None, ge=-90, le=90),
    lon: float | None = Query(default=None, ge=-180, le=180),
    name: str | None = Query(default=None, max_length=120),
    force: bool = False,
) -> WeatherView:
    """Device location when ``lat``/``lon`` are given, else the saved city."""
    return services.forecast(ctx, lat=lat, lon=lon, name=name, force=force)


@router.get("/cities", response_model=list[PlacePublic], dependencies=READ)
def search_cities(q: str = Query(min_length=1, max_length=80)) -> list[PlacePublic]:
    return services.search_cities(q)
