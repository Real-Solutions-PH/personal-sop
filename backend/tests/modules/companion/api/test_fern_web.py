"""Fern looks things up on the web: an unfamiliar dish is searched, then
logged with the numbers found. Brave is replaced at its one seam."""

import json
from typing import Any

import pytest
from fastapi.testclient import TestClient
from langchain_core.messages import ToolMessage
from sqlmodel import Session

from app.core.config import settings
from app.modules.companion import web
from tests.modules.capture.api.helpers import call, install, parse_agui, say, user
from tests.modules.companion.api.meal_items import full


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
                    full(
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
                    )
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
                    full(
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
                    )
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


def test_a_search_never_loses_the_food_it_is_for() -> None:
    """Seen live 2026-11-14: "check again on the macro for the size of my
    serving for andoks chicken in the web" was searched as "nutrition facts
    calories protein per serving", the brand stripped, and found nothing."""
    from app.modules.companion.services import own_words

    said = (
        "can you check again on the macro for the size of my serving for "
        "andoks chicken in the web"
    )
    # "Andok's" is the "andoks" they typed: kept, with the words they said.
    assert (
        own_words("Andok's Litson Manok nutrition facts calories protein", said)
        == "Andok's nutrition facts calories protein"
    )
    # Only search words would be left: the model's query goes out whole.
    q = "Litson Manok per 100g calories protein fat nutrition Philippines"
    assert own_words(q, "how about that one") == q


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
                    full(
                        {
                            "name": "Chicken",
                            "kcal": 350,
                            "protein": 25,
                            "carbs": 30,
                            "fat": 15,
                            "sugar": 2,
                            "sodium": 500,
                            "grams": 200,
                        }
                    ),
                    full(
                        {
                            "name": "Rice",
                            "kcal": 205,
                            "protein": 4,
                            "carbs": 45,
                            "fat": 0.5,
                            "sugar": 0,
                            "sodium": 2,
                            "grams": 158,
                        }
                    ),
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


def test_the_day_after_a_meal_counts_every_meal_still_waiting(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Seen live 2026-11-10: breakfast, lunch and a snack were logged in one
    reply, all waiting for an OK (1,266 kcal together), and the reply said
    "with all three in, that's 604.5 kcal for the day": each call counted
    only its own meal on top of what was saved."""
    from app.modules.fitness import services as S
    from tests.utils.mobile import ctx_for

    api = user(client, db)
    api.assign("chat")
    with ctx_for(api.user) as ctx:  # type: ignore[attr-defined]
        S.set_macro_target(ctx=ctx, kcal=1750, protein=140, carbs=185, fat=50)
        ctx.commit()

    def meal(label: str, kcal: float, protein: float) -> Any:
        return call(
            "log_meal",
            description=label,
            label=label,
            items=[
                full(
                    {
                        "name": f"{label} plate",
                        "kcal": kcal,
                        "protein": protein,
                        "carbs": round((kcal - 4 * protein) / 4, 1),
                        "grams": 200,
                    }
                )
            ],
            confidence=0.5,
        )

    model = install(
        monkeypatch,
        say("", meal("breakfast", 452, 21.1)),
        say("", meal("lunch", 502, 33.5)),
        say("", meal("snack", 312, 7.1)),
        say("Logged."),
    )
    ask(client, api, "breakfast, lunch and snack")
    last = next(
        json.loads(str(m.content))
        for m in reversed(model.seen[3])
        if isinstance(m, ToolMessage)
    )
    after = last["day_after_this_meal"]
    # 452 + 502 + 312 = 1,266 eaten once confirmed; 484 left of 1,750.
    assert after["eaten_today_with_this_meal"]["kcal"] == 1266.0, after
    assert after["left_today"]["kcal"] == 484.0
    assert [m["meal"] for m in after["also_waiting_and_counted"]] == [
        "breakfast",
        "lunch",
    ]


def test_nutrition_status_lists_the_meals_waiting_for_an_ok(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Seen live 2026-11-13: "counting only the pizza, today leaves 1485
    kcal" while a 605 kcal breakfast also waited: the day read from the
    records alone left every waiting meal out."""
    api = user(client, db)
    api.assign("chat")
    model = install(
        monkeypatch,
        say(
            "",
            call(
                "log_meal",
                description="7-Eleven breakfast",
                label="breakfast",
                items=[
                    full({"name": "Sandwich", "kcal": 360, "carbs": 90, "grams": 103})
                ],
                confidence=0.5,
            ),
        ),
        say("", call("nutrition_status")),
        say("Logged."),
    )
    ask(client, api, "7-eleven sandwich for breakfast")
    status = next(
        json.loads(str(m.content))
        for m in reversed(model.seen[2])
        if isinstance(m, ToolMessage)
    )
    assert status["waiting_for_ok"][0]["meal"] == "breakfast", status
    assert status["waiting_for_ok"][0]["kcal"] == 360.0
    assert status["eaten_once_confirmed"]["kcal"] == 360.0
