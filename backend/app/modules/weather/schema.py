import uuid
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

TempUnit = Literal["c", "f"]


class PlacePublic(BaseModel):
    name: str
    detail: str | None = None
    lat: float
    lon: float


class WeatherPrefPublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    source: Literal["device", "city"]
    city_name: str
    city_detail: str | None
    city_lat: float
    city_lon: float
    unit: TempUnit
    asked: bool
    version: int


class WeatherPrefUpdate(BaseModel):
    """Also the sync payload: every field optional."""

    source: Literal["device", "city"] | None = None
    city_name: str | None = Field(default=None, min_length=1, max_length=120)
    city_detail: str | None = Field(default=None, max_length=160)
    city_lat: float | None = Field(default=None, ge=-90, le=90)
    city_lon: float | None = Field(default=None, ge=-180, le=180)
    unit: TempUnit | None = None
    asked: bool | None = None


class AdvicePublic(BaseModel):
    kind: str
    tone: Literal["good", "warn", "bad"]
    text: str


class WeatherView(BaseModel):
    """Everything the Weather screen and the Today card render."""

    place: PlacePublic
    forecast: dict[str, Any]
    current: dict[str, Any]
    plan: dict[str, Any]
    advice: AdvicePublic
    rain_soon: float
    unit: TempUnit
    fetched_at_ms: int
    stale: bool
