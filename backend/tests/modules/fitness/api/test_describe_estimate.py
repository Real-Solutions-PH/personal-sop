"""POST /fitness/meals/estimate ("Describe your meal") with an AI model.

The model is substituted at ``meal_ai.ask`` and the lookup at
``meal_ai._resolve``; without them the route keeps the food table (the
other estimate tests, which run with no model).
"""

import json
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session

from app.modules.fitness import meal_ai
from tests.modules.fitness.api.helpers import API, ok
from tests.utils.mobile import signed_in

CHICKEN = {
    "name": "Fried chicken thigh",
    "qty": 1,
    "unit": "pc",
    "grams": 120,
    "kcal": 320,
    "protein": 26,
    "carbs": 8,
    "fat": 20,
    "fiber": 0.3,
    "sat_fat": 5.5,
    "sugar": 0,
    "sodium": 480,
}
RICE = {
    "name": "Steamed rice",
    "qty": 1.5,
    "unit": "cup",
    "grams": 240,
    "kcal": 308,
    "protein": 6,
    "carbs": 67,
    "fat": 0.7,
}


@pytest.fixture
def answers(monkeypatch: pytest.MonkeyPatch) -> list[str]:
    queue: list[str] = []
    monkeypatch.setattr(meal_ai, "_resolve", lambda _ctx: object())
    monkeypatch.setattr(
        meal_ai, "ask", lambda _c, _r, _t: queue.pop(0) if queue else None
    )
    return queue


def _items(*items: dict[str, Any]) -> str:
    return json.dumps({"items": list(items), "confidence": 0.85})


def test_described_meal_keeps_every_food_with_its_detail(
    client: TestClient, db: Session, answers: list[str]
) -> None:
    _, h = signed_in(db)
    answers.append(_items(RICE, CHICKEN))
    m = ok(
        client.post(
            f"{API}/meals/estimate",
            headers=h,
            json={"text": "1.5 cups rice and fried chicken", "label": "lunch"},
        )
    )
    assert m["status"] == "estimated" and m["follow_up"] is None
    assert [i["name"] for i in m["items"]] == ["Steamed rice", "Fried chicken thigh"]
    assert m["totals"]["kcal"] == 308 + 320
    chicken = m["items"][1]
    assert (chicken["sat_fat"], chicken["sodium"]) == (5.5, 480)
    assert chicken["assumption"] == "about 120 g"
    assert m["confidence"] == pytest.approx(0.85)


def test_reestimate_sends_the_hint_as_a_correction(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    _, h = signed_in(db)
    m = ok(client.post(f"{API}/meals/estimate", headers=h, json={"text": "rice"}))
    sent: list[str] = []

    def ask(_c: Any, _r: Any, text: str) -> str:
        sent.append(text)
        return _items(RICE | {"qty": 2, "grams": 320, "kcal": 410, "carbs": 90})

    monkeypatch.setattr(meal_ai, "_resolve", lambda _ctx: object())
    monkeypatch.setattr(meal_ai, "ask", ask)
    again = ok(
        client.post(
            f"{API}/meals/{m['id']}/estimate", headers=h, json={"hint": "2 cups"}
        )
    )
    assert sent and sent[0].endswith("Meal: rice\nCorrection: 2 cups")
    assert [(i["qty"], i["kcal"]) for i in again["items"]] == [(2, 410)]


@pytest.mark.usefixtures("answers")
def test_a_model_that_answers_nothing_falls_back_to_the_table(
    client: TestClient, db: Session
) -> None:
    _, h = signed_in(db)
    m = ok(client.post(f"{API}/meals/estimate", headers=h, json={"text": "2 eggs"}))
    assert [(i["name"], i["kcal"]) for i in m["items"]] == [("Fried egg", 180)]
