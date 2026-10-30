"""What Fern says and saves when logging a meal goes wrong.

Seen live 2026-10-29 (lunch: rice, steamed chicken, ginisang radish and
Matcha Polvoron): ``log_meal`` refused the chicken and radish for having no
sugar and sodium estimate, and the step read only "Couldn't finish: fix
these items then call again". Two ``edit_meal`` calls each added a
polvoron to the saved lunch, yet the reply was replaced with "nothing was
saved", because a meal edit did not count as a write. The next turn logged
a second lunch with two more polvoron on top of the first."""

from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session

from app.modules.capture.models import RecordCard
from app.modules.companion import services
from app.modules.fitness.models import Meal, MealItem
from tests.modules.capture.api.helpers import Api, install, say
from tests.modules.companion.api.test_fern_agent import act, live, rows_of, stream
from tests.modules.companion.api.test_fern_fitness import fern, tool_result, turn

# One piece, about 30 g: 4*2 + 4*18 + 9*8 = 152 kcal, 28 g of macros.
POLVORON = {
    "name": "Matcha Polvoron",
    "qty": 1,
    "unit": "piece",
    "kcal": 150,
    "protein": 2,
    "carbs": 18,
    "fat": 8,
    "sugar": 9,
    "sodium": 40,
    "grams": 30,
}
# 4*30 + 9*4 = 156 kcal; no sugar or sodium, as the model sent it live.
CHICKEN = {
    "name": "Steamed chicken",
    "qty": 1,
    "unit": "serving",
    "kcal": 160,
    "protein": 30,
    "carbs": 0,
    "fat": 4,
    "grams": 120,
}


def _lunch(api: Api) -> str:
    """A lunch already saved today, as the live one was."""
    return str(
        api.post(
            "/fitness/meals",
            {
                "label": "lunch",
                "raw_input": "rice and polvoron",
                "items": [
                    {
                        "name": "White rice",
                        "qty": 1,
                        "unit": "cup",
                        "kcal": 205,
                        "protein": 4,
                        "carbs": 45,
                        "fat": 0,
                    },
                    {
                        "name": "Matcha Polvoron",
                        "qty": 1,
                        "unit": "piece",
                        "kcal": 150,
                        "protein": 2,
                        "carbs": 18,
                        "fat": 8,
                    },
                ],
            },
        )["id"]
    )


def _reply(events: list[dict[str, Any]]) -> str:
    return str(events[-1]["result"]["messages"][1]["text"])


def _steps(events: list[dict[str, Any]]) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = events[-1]["result"]["messages"][1]["blocks"][0][
        "items"
    ]
    return items


def test_an_estimate_without_sugar_and_sodium_is_saved_and_says_so(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    api = fern(client, db)
    step, model = turn(
        api,
        client,
        monkeypatch,
        "lunch was steamed chicken",
        act(
            "log_meal",
            description="Lunch: steamed chicken",
            items=[CHICKEN],
            confidence=0.9,
        ),
    )
    out = tool_result(model)
    assert "error" not in out, out
    assert step["ok"], step
    [card] = [c for c in rows_of(api, RecordCard) if c.kind == "meal"]
    assert card.warn == "No sugar or sodium estimate for Steamed chicken"


def test_a_refused_meal_says_which_item_and_what_is_wrong(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    api = fern(client, db)
    no_weight = {k: v for k, v in CHICKEN.items() if k != "grams"}
    step, _ = turn(
        api,
        client,
        monkeypatch,
        "lunch was steamed chicken",
        act("log_meal", description="Lunch: steamed chicken", items=[no_weight]),
    )
    assert not step["ok"]
    assert step["summary"] == (
        "Not saved: Steamed chicken has no portion weight in grams"
    )


def test_a_meal_edit_counts_as_saved_so_the_reply_is_kept(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    api = fern(client, db)
    meal_id = _lunch(api)
    install(
        monkeypatch,
        say("", act("edit_meal", meal_id=meal_id, add_items=[POLVORON])),
        say("Added a Matcha Polvoron to your lunch."),
        say("Added a Matcha Polvoron to your lunch."),
    )
    events = stream(api, client, "add 1 more matcha polvoron to my lunch")
    assert _reply(events) == "Added a Matcha Polvoron to your lunch."


def test_a_claim_after_a_refused_write_names_what_failed(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    api = fern(client, db)
    no_weight = {k: v for k, v in CHICKEN.items() if k != "grams"}
    install(
        monkeypatch,
        say("", act("log_meal", description="Lunch: chicken", items=[no_weight])),
        say("Logged your lunch."),
        say("Your lunch is logged."),
    )
    events = stream(api, client, "lunch was steamed chicken")
    assert not [m for m in rows_of(api, Meal) if m.label == "lunch"]
    assert _reply(events) == (
        "I couldn't save that, so nothing was recorded: Steamed chicken has no "
        "portion weight in grams. Tell me roughly how much it was and I'll "
        "log it."
    )


def test_adding_the_same_food_twice_in_one_reply_adds_it_once(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    api = fern(client, db)
    meal_id = _lunch(api)
    install(
        monkeypatch,
        say("", act("edit_meal", meal_id=meal_id, add_items=[POLVORON])),
        say("", act("edit_meal", meal_id=meal_id, add_items=[POLVORON])),
        say("Added it."),
    )
    events = stream(api, client, "add 1 more matcha polvoron to my lunch")
    polvoron = [i for i in live(rows_of(api, MealItem)) if i.name == "Matcha Polvoron"]
    # The one the lunch was logged with, and the one added now.
    assert len(polvoron) == 2
    second = _steps(events)[1]
    assert second["ok"]
    assert "already added" in second["summary"]


def test_logging_a_saved_lunch_again_points_at_it_instead(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    api = fern(client, db)
    meal_id = _lunch(api)
    _, model = turn(
        api,
        client,
        monkeypatch,
        "lunch was rice and 2 matcha polvoron",
        act(
            "log_meal",
            description="Lunch: rice and 2 matcha polvoron",
            items=[
                POLVORON
                | {
                    "qty": 2,
                    "kcal": 300,
                    "protein": 4,
                    "carbs": 36,
                    "fat": 16,
                    "sugar": 18,
                    "sodium": 80,
                    "grams": 60,
                }
            ],
            confidence=0.9,
        ),
    )
    out = tool_result(model)
    assert out["error"] == "lunch_already_logged_today_change_it_with_edit_meal"
    assert out["meal_id"] == meal_id
    assert len([m for m in live(rows_of(api, Meal)) if m.label == "lunch"]) == 1


def test_a_second_lunch_eaten_again_is_still_logged(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    api = fern(client, db)
    _lunch(api)
    _, model = turn(
        api,
        client,
        monkeypatch,
        "I had another polvoron as a second lunch",
        act(
            "log_meal",
            description="Lunch: matcha polvoron",
            items=[POLVORON],
            confidence=0.9,
            eaten_again=True,
        ),
    )
    assert "error" not in tool_result(model)


def test_every_tool_is_either_a_write_or_a_read() -> None:
    from app.modules.companion.turn import RUNNING

    writes, reads = services.WRITE_TOOLS, services.READ_TOOLS
    assert not writes & reads
    assert set(RUNNING) == writes | reads


def test_the_missing_estimate_warning_fits_the_card_column() -> None:
    """Many long names would overflow the card's 280-character warning and
    fail the save, losing the meal."""
    from app.modules.capture import ports

    items = [
        {**CHICKEN, "name": f"Grilled chicken inasal plate number {i}" * 3}
        for i in range(30)
    ]
    warn = ports.meal_missing_details(items)
    assert warn is not None and len(warn) <= ports.WARN_MAX
    assert warn.endswith("and 27 more")
