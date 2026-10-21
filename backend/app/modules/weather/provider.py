"""The one seam to Open-Meteo. Tests replace ``fetch_json``; nothing else in
the module performs network I/O."""

from collections.abc import Callable
from typing import Any

import httpx

from app.core.config import settings

VARS = (
    "temperature_2m,apparent_temperature,precipitation_probability,precipitation,"
    "weather_code,wind_speed_10m,uv_index,relative_humidity_2m,is_day"
)
DAILY = (
    "weather_code,temperature_2m_max,temperature_2m_min,apparent_temperature_max,"
    "precipitation_probability_max,precipitation_sum,uv_index_max,"
    "wind_speed_10m_max,sunrise,sunset"
)


class WeatherUnavailable(Exception):
    pass


def _get(url: str, params: dict[str, str]) -> dict[str, Any]:
    try:
        resp = httpx.get(url, params=params, timeout=12)
        resp.raise_for_status()
        data: dict[str, Any] = resp.json()
        return data
    except (httpx.HTTPError, ValueError) as exc:
        raise WeatherUnavailable from exc


FetchJson = Callable[[str, dict[str, str]], dict[str, Any]]
fetch_json: FetchJson = _get


def forecast_params(lat: float, lon: float) -> dict[str, str]:
    return {
        "latitude": f"{lat:.4f}",
        "longitude": f"{lon:.4f}",
        "current": VARS.replace("precipitation_probability,", ""),
        "hourly": VARS,
        "daily": DAILY,
        "timezone": "auto",
        "forecast_days": "7",
        "wind_speed_unit": "kmh",
    }


def forecast(lat: float, lon: float) -> dict[str, Any]:
    return fetch_json(settings.WEATHER_FORECAST_URL, forecast_params(lat, lon))


def geocode(query: str) -> dict[str, Any]:
    return fetch_json(
        settings.WEATHER_GEOCODE_URL,
        {"name": query, "count": "8", "language": "en", "format": "json"},
    )
