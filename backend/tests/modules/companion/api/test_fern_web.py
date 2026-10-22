"""Fern looks things up on the web: an unfamiliar dish is searched, then
logged with the numbers found. Brave is replaced at its one seam."""

from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session

from app.core.config import settings
from app.modules.companion import web
from tests.modules.capture.api.helpers import call, install, parse_agui, say, user


def ask(client: TestClient, api: Any, text: str) -> list[dict[str, Any]]:
    r = client.post("/api/v1/companion/ask/stream", headers=api.h, json={"text": text})
    assert r.status_code == 200, r.text
    return parse_agui(r.text)


def test_an_unknown_dish_is_searched_then_logged_with_those_numbers(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    api = user(client, db)
    api.assign("chat")
    monkeypatch.setattr(settings, "BRAVE_API_KEY", "brave-test")
    searched: list[str] = []

    def fake(query: str, **_: Any) -> list[dict[str, Any]]:
        searched.append(query)
        return [
            {
                "title": "Classic Savory Chicken nutrition",
                "url": "https://example.com/classic-savory",
                "snippet": "1 piece (160 g): 420 kcal, 34 g protein, 12 g carbs, 26 g fat",
            }
        ]

    monkeypatch.setattr(web, "search", fake)
    model = install(
        monkeypatch,
        say("", call("web_search", query="Classic Savory chicken nutrition")),
        say(
            "",
            call(
                "log_meal",
                description="Classic Savory chicken, 1 piece",
                items=[
                    {
                        "name": "Classic Savory chicken",
                        "qty": 1,
                        "unit": "piece",
                        "kcal": 420,
                        "protein": 34,
                        "carbs": 12,
                        "fat": 26,
                    }
                ],
                confidence=0.8,
            ),
        ),
        say("Logged 420 kcal from Classic Savory's own nutrition page."),
    )
    events = ask(client, api, "had classic savory chicken for lunch")
    assert searched == ["Classic Savory chicken nutrition"]
    # The search results reached the model before it logged the meal.
    assert "420 kcal, 34 g protein" in str(model.seen[1])
    starts = [e["toolCallName"] for e in events if e.get("type") == "TOOL_CALL_START"]
    assert starts == ["web_search", "log_meal"]


def test_without_a_search_key_the_tool_says_so(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    api = user(client, db)
    api.assign("chat")
    monkeypatch.setattr(settings, "BRAVE_API_KEY", None)
    model = install(
        monkeypatch,
        say("", call("web_search", query="sinigang nutrition")),
        say("I couldn't search the web just now."),
    )
    ask(client, api, "how many calories in sinigang?")
    assert "web_search_unavailable" in str(model.seen[1])
