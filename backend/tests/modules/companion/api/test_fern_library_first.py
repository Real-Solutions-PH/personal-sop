"""Fern logs a meal from the person's food library first, a misread label
never enters the library, and a refusal Fern fixes in the same reply is not
left in the reply as an error.

Seen in Kai's chats 2026-10-22 to 11-04: of 152 items Fern logged, 31 took
their values from the library. 39 more named a library food and kept the
model's guess, because their amount could not be scaled to the food's basis
("1 serving" of a per-100 g rice with its 150 g known, "1 sachet" of a
per-serving whey). Fern looked in the library in 21 of 82 meal replies.
"""

from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session

from app.modules.capture.models import RecordCard
from app.modules.fitness import food_library as L
from app.modules.fitness.models import FoodItem
from tests.modules.capture.api.helpers import install, say
from tests.modules.companion.api.meal_items import full
from tests.modules.companion.api.test_fern_agent import act, live, rows_of, stream
from tests.modules.companion.api.test_fern_fitness import fern, tool_result
from tests.utils.mobile import ctx_for

# The library entries as Kai's library holds them: USDA FDC 168878 (white
# rice, long-grain, cooked: 130 kcal, 2.69 g protein, 28.2 g carbs, 0.28 g
# fat per 100 g); a whey from its label, per 30 g sachet; Kai's fried egg,
# per piece, with no piece weight.
RICE = L.FoodDraft(
    name="White rice, long-grain, cooked",
    aliases=["kanin", "plain rice", "rice"],
    basis="100g",
    kcal=130,
    protein=2.69,
    carbs=28.2,
    fat=0.28,
    source="usda",
    verified=True,
)
WHEY = L.FoodDraft(
    name="Prothin Whey",
    basis="serving",
    unit_grams=30,
    kcal=115,
    protein=25,
    carbs=3,
    fat=0.5,
    source="label",
    verified=True,
)
EGG = L.FoodDraft(
    name="Fried egg in olive oil (Kai's standard)",
    aliases=["egg", "fried egg", "itlog"],
    basis="piece",
    kcal=112,
    protein=6.3,
    carbs=0.4,
    fat=9.3,
    source="usda",
    verified=True,
)


def _library(api: Any, *foods: L.FoodDraft) -> None:
    with ctx_for(api.user) as ctx:
        for f in foods:
            L.save_food(ctx, f)
        ctx.commit()


def _meal_items(api: Any) -> list[dict[str, Any]]:
    [card] = [c for c in rows_of(api, RecordCard) if c.kind == "meal"]
    items: list[dict[str, Any]] = card.payload["items"]
    return items


def _logs(*items: dict[str, Any]) -> Any:
    return act("log_meal", description="Lunch", items=list(items), confidence=0.9)


def test_a_serving_with_its_grams_takes_the_library_values(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Live 2026-10-24: "Cooked white rice 150g", 1 serving, kept the
    model's numbers though the library has the rice per 100 g."""
    api = fern(client, db)
    _library(api, RICE)
    rice = full(
        {
            "name": "Cooked white rice",
            "qty": 1,
            "unit": "serving",
            "grams": 150,
            "kcal": 210,
            "protein": 5,
            "carbs": 45,
            "fat": 1,
        }
    )
    model = install(monkeypatch, say("", _logs(rice)), say("Logged."))
    stream(api, client, "lunch was 150g rice")
    assert tool_result(model)["from_library"] == [RICE.name]
    [item] = _meal_items(api)
    # 150 g of the library's rice: 1.5 x (130, 2.69, 28.2, 0.28).
    assert (item["kcal"], item["protein"], item["carbs"], item["fat"]) == (
        195.0,
        4.0,
        42.3,
        0.4,
    )
    assert item["assumption"] == f"From your food library: {RICE.name}, about 150 g"
    assert "grams" not in item


@pytest.mark.parametrize("unit", ["sachet", "sachet (30g)", "serving (1 sachet)"])
def test_a_counted_unit_of_a_per_serving_food_is_servings(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch, unit: str
) -> None:
    """Live 2026-10-24 and 10-31: "1 sachet" and "1 sachet (30g)" of the
    library's per-serving whey were not taken from it."""
    api = fern(client, db)
    _library(api, WHEY)
    whey = full(
        {"name": "Prothin Whey", "qty": 1, "unit": unit, "kcal": 110, "protein": 24}
    )
    model = install(monkeypatch, say("", _logs(whey)), say("Logged."))
    stream(api, client, "had my prothin whey")
    assert tool_result(model)["from_library"] == ["Prothin Whey"]
    [item] = _meal_items(api)
    assert (item["kcal"], item["protein"]) == (115.0, 25.0)


def test_an_item_near_a_library_food_is_sent_back_once_with_it(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Live 2026-10-31 and 11-01: "Fried egg, unsalted, 46 g" named Kai's
    standard egg, kept per piece, and the model's own 86 kcal was saved.
    Now the item goes back with the library egg; sent as 1 piece it takes
    the library's values, and the reply keeps only the step that saved."""
    api = fern(client, db)
    _library(api, EGG)
    guess = full(
        {
            "name": "Fried egg, unsalted",
            "qty": 46,
            "unit": "g",
            "grams": 46,
            "kcal": 86,
            "protein": 6,
            "carbs": 0,
            "fat": 6.5,
        }
    )
    again = guess | {"name": EGG.name, "qty": 1, "unit": "piece"}
    del again["grams"]
    model = install(
        monkeypatch,
        say("", _logs(guess)),
        say("", _logs(again)),
        say("Logged your egg from your library."),
    )
    events = stream(api, client, "breakfast was a fried egg")
    first = tool_result(model)
    assert first["error"] == "check_your_library_first"
    [near] = first["items"]
    assert near["item"] == "Fried egg, unsalted"
    assert [f["name"] for f in near["library_foods"]] == [EGG.name]
    [item] = _meal_items(api)
    assert (item["kcal"], item["protein"], item["fat"]) == (112.0, 6.3, 9.3)
    steps = events[-1]["result"]["messages"][1]["blocks"][0]["items"]
    assert [(s["tool"], s["ok"]) for s in steps] == [("log_meal", True)]


def test_a_food_with_nothing_near_in_the_library_is_not_sent_back(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    api = fern(client, db)
    _library(api, RICE, EGG)
    # 4*25 + 9*12 = 208 kcal.
    tilapia = full(
        {
            "name": "Fried tilapia",
            "qty": 1,
            "unit": "piece",
            "grams": 120,
            "kcal": 215,
            "protein": 25,
            "carbs": 0,
            "fat": 12,
        }
    )
    model = install(monkeypatch, say("", _logs(tilapia)), say("Logged."))
    stream(api, client, "dinner was fried tilapia")
    assert "error" not in tool_result(model)


def test_a_misread_label_is_refused_before_it_enters_the_library(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Live 2026-10-29: a sandwich label was saved at 312 kcal with 0 g
    protein, carbs and fat, so every later meal with it counted no macros."""
    api = fern(client, db)
    misread = {
        "name": "Fresh Tuna Cheesemelt",
        "basis": "serving",
        "kcal": 312,
        "source": "label",
    }
    # 4*14 + 4*36 + 9*12 = 308 kcal: values that agree.
    read = misread | {"protein": 14, "carbs": 36, "fat": 12}
    model = install(
        monkeypatch,
        say("", act("save_food", **misread)),
        say("", act("save_food", **read)),
        say("Saved the Fresh Tuna Cheesemelt to your library."),
    )
    events = stream(api, client, "save this label")
    first = tool_result(model)
    assert first["error"] == "fix_this_food_then_call_again"
    assert [p["problem"] for p in first["problems"]] == ["kcal_does_not_match_macros"]
    [f] = live(rows_of(api, FoodItem))
    assert (f.kcal, f.protein, f.carbs, f.fat) == (312, 14, 36, 12)
    steps = events[-1]["result"]["messages"][1]["blocks"][0]["items"]
    assert [(s["tool"], s["ok"]) for s in steps] == [("save_food", True)]


def test_calories_the_person_said_are_saved_as_said(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    api = fern(client, db)
    model = install(
        monkeypatch,
        say(
            "",
            act(
                "save_food",
                name="Pancit Canton",
                basis="piece",
                kcal=290,
                source="said",
            ),
        ),
        say("Saved."),
    )
    stream(api, client, "save pancit canton: 290 kcal per pack")
    assert "error" not in tool_result(model)


def test_a_refusal_never_made_good_still_shows(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Only a refusal the same tool then made good leaves the reply."""
    api = fern(client, db)
    misread = {
        "name": "Mystery bar",
        "basis": "serving",
        "kcal": 300,
        "source": "label",
    }
    install(
        monkeypatch,
        say("", act("save_food", **misread)),
        say("I couldn't read that label."),
    )
    events = stream(api, client, "save this label")
    [step] = events[-1]["result"]["messages"][1]["blocks"][0]["items"]
    assert (step["tool"], step["ok"]) == ("save_food", False)
