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
                        "sugar": 1,
                        "sodium": 800,
                        "grams": 200,
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


def test_a_promise_to_log_after_searching_gets_the_corrective_pass(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Seen live on 2026-10-22: Fern searched, then said "I'll log it for
    you now" and stopped; nothing was saved."""
    api = user(client, db)
    api.assign("chat")
    monkeypatch.setattr(settings, "BRAVE_API_KEY", "brave-test")
    monkeypatch.setattr(
        web,
        "search",
        lambda q, **_: [{"title": "t", "url": "u", "snippet": "420 kcal"}],
    )
    model = install(
        monkeypatch,
        say("", call("web_search", query="Classic Savory chicken nutrition")),
        say("I found it. I'll log it for you now."),
        say(
            "",
            call(
                "log_meal",
                description="Classic Savory chicken",
                items=[
                    {
                        "name": "Classic Savory chicken",
                        "kcal": 420,
                        "protein": 34,
                        "carbs": 12,
                        "fat": 26,
                        "sugar": 1,
                        "sodium": 800,
                        "grams": 200,
                    }
                ],
                confidence=0.8,
            ),
        ),
        say("Logged 420 kcal."),
    )
    events = ask(client, api, "had classic savory chicken for lunch")
    assert len(model.seen) == 4
    starts = [e["toolCallName"] for e in events if e.get("type") == "TOOL_CALL_START"]
    assert starts == ["web_search", "log_meal"]


def test_a_search_keeps_to_the_words_the_person_said() -> None:
    from app.modules.companion.services import own_words

    said = "had 1 piece Classic Savory chicken with 1 cup rice for lunch"
    assert (
        own_words("Classic Savory chicken sandwich nutrition", said)
        == "Classic Savory chicken nutrition"
    )
    # Nothing in common: the model's query stands.
    assert own_words("sinigang calories", "what's in that?") == "sinigang calories"


def test_logging_a_meal_hands_back_the_day_with_it_counted(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Seen live: after logging, Fern added the day up itself and left out
    the meal already eaten that morning."""
    from app.modules.fitness import foods as F
    from app.modules.fitness import services as S
    from tests.utils.mobile import ctx_for

    api = user(client, db)
    api.assign("chat")
    with ctx_for(api.user) as ctx:  # type: ignore[attr-defined]
        S.set_macro_target(ctx=ctx, kcal=1950, protein=140, carbs=235, fat=50)
        S.log_meal(
            ctx=ctx, items=[F.ItemDraft("Breakfast", 1, "plate", 480, 42.6, 45, 14)]
        )
        ctx.commit()
    model = install(
        monkeypatch,
        say(
            "",
            call(
                "log_meal",
                description="chicken and rice",
                items=[
                    {
                        "name": "Chicken",
                        "kcal": 350,
                        "protein": 25,
                        "carbs": 30,
                        "fat": 15,
                        "sugar": 2,
                        "sodium": 500,
                        "grams": 200,
                    },
                    {
                        "name": "Rice",
                        "kcal": 205,
                        "protein": 4,
                        "carbs": 45,
                        "fat": 0.5,
                        "sugar": 0,
                        "sodium": 2,
                        "grams": 158,
                    },
                ],
                confidence=0.5,
            ),
        ),
        say("Logged."),
    )
    ask(client, api, "had chicken and rice for lunch")
    seen = str(model.seen[1])
    # 480 already eaten + 555 for this (still waiting) meal = 1,035; 915 left.
    assert '"kcal": 1035.0' in seen and '"kcal": 915.0' in seen
