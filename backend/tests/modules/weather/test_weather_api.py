"""Weather routes with Open-Meteo replaced at its one seam."""

import uuid
from collections.abc import Generator
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, delete

from app.core.config import settings
from app.modules.weather import provider
from app.modules.weather.models import WeatherCache
from tests.modules.weather.test_weather_logic import GOLDEN
from tests.utils.mobile import signed_in

API = f"{settings.API_V1_STR}/weather"


class FakeOpenMeteo:
    def __init__(self) -> None:
        self.calls: list[tuple[str, dict[str, str]]] = []
        self.fail = False

    def __call__(self, url: str, params: dict[str, str]) -> dict[str, Any]:
        self.calls.append((url, params))
        if self.fail:
            raise provider.WeatherUnavailable
        if url == settings.WEATHER_GEOCODE_URL:
            return {
                "results": [
                    {
                        "name": "Cebu City",
                        "latitude": 10.3,
                        "longitude": 123.9,
                        "admin1": "Central Visayas",
                        "country": "Philippines",
                    },
                    {"name": "broken"},
                ]
            }
        payload: dict[str, Any] = GOLDEN["payloads"][7]  # a dry, hot day
        return payload


@pytest.fixture()
def fake(
    monkeypatch: pytest.MonkeyPatch, db: Session
) -> Generator[FakeOpenMeteo, None, None]:
    db.execute(delete(WeatherCache))
    db.commit()
    f = FakeOpenMeteo()
    monkeypatch.setattr(provider, "fetch_json", f)
    yield f


def test_prefs_default_to_manila_and_update(client: TestClient, db: Session) -> None:
    _, h = signed_in(db)
    p = client.get(f"{API}/prefs", headers=h).json()
    assert (p["city_name"], p["unit"], p["source"]) == ("Manila", "c", "city")
    p = client.patch(
        f"{API}/prefs",
        headers=h,
        json={
            "unit": "f",
            "city_name": "Cebu City",
            "city_lat": 10.3,
            "city_lon": 123.9,
        },
    ).json()
    assert (p["unit"], p["city_name"]) == ("f", "Cebu City")
    assert (
        client.patch(f"{API}/prefs", headers=h, json={"city_lat": 91}).status_code
        == 422
    )


def test_forecast_is_cached_per_cell_and_shared(
    client: TestClient, db: Session, fake: FakeOpenMeteo
) -> None:
    _, alice = signed_in(db)
    _, bob = signed_in(db)
    v = client.get(f"{API}/forecast", headers=alice)
    assert v.status_code == 200, v.text
    body = v.json()
    assert body["place"]["name"] == "Manila" and body["advice"]["text"]
    assert {"label", "hours", "best", "worst"} <= set(body["plan"])
    assert body["stale"] is False
    # Bob in the same ~1 km cell reuses the cached forecast.
    client.get(f"{API}/forecast?lat=14.6011&lon=120.9811", headers=bob)
    assert len(fake.calls) == 1
    # force refetches; another cell fetches.
    client.get(f"{API}/forecast?force=true", headers=alice)
    client.get(f"{API}/forecast?lat=10.3&lon=123.9&name=Cebu", headers=alice)
    assert len(fake.calls) == 3
    assert fake.calls[0][1]["latitude"] == "14.5995"


def test_outage_serves_last_forecast_else_503(
    client: TestClient, db: Session, fake: FakeOpenMeteo
) -> None:
    _, h = signed_in(db)
    fake.fail = True
    r = client.get(f"{API}/forecast", headers=h)
    assert r.status_code == 503 and r.json()["code"] == "weather_unavailable"
    fake.fail = False
    assert client.get(f"{API}/forecast", headers=h).status_code == 200
    fake.fail = True
    stale = client.get(f"{API}/forecast?force=true", headers=h)
    assert stale.status_code == 200  # last good forecast instead of an error


def test_city_search_skips_malformed_results(
    client: TestClient, db: Session, fake: FakeOpenMeteo
) -> None:
    _, h = signed_in(db)
    found = client.get(f"{API}/cities?q=cebu", headers=h).json()
    assert found == [
        {
            "name": "Cebu City",
            "detail": "Central Visayas, Philippines",
            "lat": 10.3,
            "lon": 123.9,
        }
    ]
    assert client.get(f"{API}/cities?q=c", headers=h).json() == []
    assert len(fake.calls) == 1


def test_weather_pref_syncs(client: TestClient, db: Session) -> None:
    _, h = signed_in(db)
    op = {
        "op_id": str(uuid.uuid4()),
        "kind": "upsert",
        "name": "weather_pref",
        "id": str(uuid.uuid4()),
        "data": {"unit": "f", "asked": True},
    }
    res = client.post(
        f"{settings.API_V1_STR}/sync/push", headers=h, json={"ops": [op]}
    ).json()["results"][0]
    assert res["status"] == "applied" and res["row"]["unit"] == "f"
    assert client.get(f"{API}/prefs", headers=h).json()["asked"] is True
