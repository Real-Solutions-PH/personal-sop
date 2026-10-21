"""Weather preferences (per user) and the shared forecast cache."""

import uuid
from datetime import datetime

from sqlalchemy import Float, String, UniqueConstraint
from sqlmodel import Field, SQLModel

from app.shared.owned import JSONB, OwnedRow, enum_check, tstz


class WeatherPref(OwnedRow, table=True):
    __tablename__ = "weather_pref"
    __table_args__ = (
        UniqueConstraint("owner_id", name="uq_weather_pref_owner"),
        enum_check("source", ("device", "city"), name="ck_weather_source"),
        enum_check("unit", ("c", "f"), name="ck_weather_unit"),
    )

    source: str = Field(default="city", sa_type=String(6))  # type: ignore
    city_name: str = Field(default="Manila", max_length=120)
    city_detail: str | None = Field(default="Metro Manila, Philippines", max_length=160)
    city_lat: float = Field(default=14.5995, sa_type=Float)
    city_lon: float = Field(default=120.9842, sa_type=Float)
    unit: str = Field(default="c", sa_type=String(1))  # type: ignore
    asked: bool = False


class WeatherCache(SQLModel, table=True):
    """Global, not user data: forecasts keyed by a ~1 km grid cell."""

    __tablename__ = "weather_cache"
    __table_args__ = (UniqueConstraint("cell", name="uq_weather_cache_cell"),)

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    cell: str = Field(max_length=32)  # "14.60,120.98"
    fetched_at: datetime = Field(sa_type=tstz())  # type: ignore
    payload: dict[str, object] = Field(sa_type=JSONB)
