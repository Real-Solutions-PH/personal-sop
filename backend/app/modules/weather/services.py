"""Weather use cases. The forecast is cached per ~1 km cell for
``WEATHER_CACHE_SECONDS`` and shared across users (it holds no user data);
coordinates arrive per request and are never stored except the chosen city."""

from datetime import timedelta
from typing import Any, Literal

from sqlmodel import select

from app.core.config import settings
from app.modules.weather import logic as W
from app.modules.weather import provider
from app.modules.weather.models import WeatherCache, WeatherPref
from app.modules.weather.schema import (
    AdvicePublic,
    PlacePublic,
    WeatherPrefUpdate,
    WeatherView,
)
from app.shared import owned_repo
from app.shared.context import Ctx
from app.shared.domain import domain_error


def get_prefs(ctx: Ctx) -> WeatherPref:
    pref = owned_repo.find_one(ctx, WeatherPref, include_deleted=True)
    if pref is None:
        pref = owned_repo.insert(ctx, WeatherPref, {})
    elif pref.deleted_at is not None:
        owned_repo.restore(ctx, pref)
    return pref


def read_prefs(ctx: Ctx) -> WeatherPref:
    pref = get_prefs(ctx)
    ctx.commit()
    ctx.session.refresh(pref)
    return pref


def update_prefs(ctx: Ctx, data: WeatherPrefUpdate) -> WeatherPref:
    pref = get_prefs(ctx)
    owned_repo.apply(pref, data.model_dump(exclude_unset=True))
    ctx.session.add(pref)
    ctx.commit()
    ctx.session.refresh(pref)
    return pref


def cell_of(lat: float, lon: float) -> str:
    return f"{round(lat, 2):.2f},{round(lon, 2):.2f}"


def _cached(
    ctx: Ctx, cell: str, lat: float, lon: float, force: bool
) -> tuple[dict[str, Any], int]:
    """Raw Open-Meteo JSON for the cell and its fetch time (epoch ms)."""
    row = ctx.session.exec(
        select(WeatherCache).where(WeatherCache.cell == cell)
    ).first()
    fresh = row is not None and ctx.now - row.fetched_at < timedelta(
        seconds=settings.WEATHER_CACHE_SECONDS
    )
    if row is not None and fresh and not force:
        return row.payload, int(row.fetched_at.timestamp() * 1000)
    try:
        payload = provider.forecast(lat, lon)
    except provider.WeatherUnavailable as exc:
        if row is not None:  # serve the last forecast, marked stale
            return row.payload, int(row.fetched_at.timestamp() * 1000)
        raise domain_error(
            503, "weather_unavailable", "The weather service is not answering"
        ) from exc
    if row is None:
        row = WeatherCache(cell=cell, fetched_at=ctx.now, payload=payload)
    else:
        row.payload, row.fetched_at = payload, ctx.now
    ctx.session.add(row)
    ctx.session.flush()
    return payload, int(ctx.now.timestamp() * 1000)


def forecast(
    ctx: Ctx,
    *,
    lat: float | None = None,
    lon: float | None = None,
    name: str | None = None,
    force: bool = False,
) -> WeatherView:
    pref = get_prefs(ctx)
    if lat is not None and lon is not None:
        place = W.Place(name=name or "Current location", lat=lat, lon=lon)
    else:
        place = W.Place(
            name=pref.city_name,
            lat=pref.city_lat,
            lon=pref.city_lon,
            detail=pref.city_detail,
        )
    payload, fetched_ms = _cached(
        ctx, cell_of(place.lat, place.lon), place.lat, place.lon, force
    )
    now_ms = int(ctx.now.timestamp() * 1000)
    try:
        f = W.parse_forecast(payload, place, fetched_ms)
    except (KeyError, TypeError, IndexError) as exc:
        raise domain_error(
            502, "weather_bad_response", "The weather service sent something unreadable"
        ) from exc
    unit: Literal["c", "f"] = "f" if pref.unit == "f" else "c"
    advice = W.outdoor_advice(f, unit, now_ms)
    ctx.commit()
    return WeatherView(
        place=PlacePublic(
            name=place.name, detail=place.detail, lat=place.lat, lon=place.lon
        ),
        forecast=W.to_dict(f),
        current=W.to_dict(W.current_conditions(f, now_ms)),
        plan=W.to_dict(W.outdoor_plan(f, now_ms)),
        advice=AdvicePublic(kind=advice.kind, tone=advice.tone, text=advice.text),
        rain_soon=W.rain_soon(f, now_ms),
        unit=unit,
        fetched_at_ms=fetched_ms,
        stale=now_ms - fetched_ms > settings.WEATHER_CACHE_SECONDS * 1000,
    )


def search_cities(query: str) -> list[PlacePublic]:
    q = query.strip()
    if len(q) < 2:
        return []
    try:
        data = provider.geocode(q)
    except provider.WeatherUnavailable as exc:
        raise domain_error(
            503, "weather_unavailable", "The weather service is not answering"
        ) from exc
    out: list[PlacePublic] = []
    for r in data.get("results") or []:
        try:
            out.append(
                PlacePublic(
                    name=str(r["name"]),
                    detail=", ".join(
                        str(x) for x in (r.get("admin1"), r.get("country")) if x
                    )
                    or None,
                    lat=float(r["latitude"]),
                    lon=float(r["longitude"]),
                )
            )
        except (KeyError, TypeError, ValueError):
            continue  # skip a malformed result rather than fail the search
    return out
