"""Meals waiting for the person's OK: a corrected version replaces the old
one, and a delete is asked for once.

Seen live on 2026-10-23: one breakfast was logged four times while its
foods were renamed, every version stayed waiting, and confirming them all
saved a stale version with the old names; two deletes of the same meal were
waiting, and the second failed once the first had run."""

import uuid
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.core.db import engine as db_engine
from app.modules.capture.models import RecordCard
from app.modules.fitness.models import Meal
from tests.modules.capture.api.helpers import Api, call, install, parse_agui, say, user


def stream(api: Api, client: TestClient, text: str) -> list[dict[str, Any]]:
    r = client.post("/api/v1/companion/ask/stream", headers=api.h, json={"text": text})
    assert r.status_code == 200
    return parse_agui(r.text)


def meal_cards(api: Api) -> list[RecordCard]:
    with Session(db_engine) as s:
        rows = s.exec(
            select(RecordCard)
            .where(RecordCard.owner_id == api.user.id)  # type: ignore[attr-defined]
            .where(RecordCard.kind == "meal")
            .order_by(RecordCard.created_at)  # type: ignore[arg-type]
        ).all()
        return list(rows)


def results(events: list[dict[str, Any]]) -> list[Any]:
    import json

    return [
        json.loads(e["content"]) for e in events if e.get("type") == "TOOL_CALL_RESULT"
    ]


def breakfast(*foods: tuple[str, float]) -> dict[str, Any]:
    return {
        "description": "Breakfast: " + " + ".join(n for n, _ in foods),
        # All carbs, so the energy adds up (4 kcal per gram).
        "items": [
            {
                "name": n,
                "kcal": k,
                "carbs": k / 4,
                "sugar": 0,
                "sodium": 0,
                "grams": 100,
            }
            for n, k in foods
        ],
        "confidence": 0.5,
    }


def test_a_corrected_breakfast_replaces_the_version_still_waiting(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    api = user(client, db, accounts=False)
    api.assign("chat")
    install(
        monkeypatch,
        say(
            "",
            call("log_meal", **breakfast(("L-Carnitine drink", 6), ("Oat snack", 129))),
        ),
        say("Breakfast is waiting for your OK."),
        # The same foods renamed: same numbers, new names.
        say(
            "",
            call("log_meal", **breakfast(("Monster Zero", 6), ("Quaker cookies", 129))),
        ),
        say("Updated; waiting for your OK."),
        # A different breakfast the same day stays as it is.
        say("", call("log_meal", **breakfast(("Rice", 206), ("Fried egg", 90)))),
        say("Post-workout breakfast is waiting too."),
    )
    stream(api, client, "breakfast was an energy drink and an oat snack")
    stream(api, client, "it was Monster Zero and Quaker cookies")
    assert [c.state for c in meal_cards(api)] == ["discarded", "proposed"]
    stream(api, client, "then after training rice and a fried egg")
    states = [(c.payload["items"][0]["name"], c.state) for c in meal_cards(api)]
    assert states == [
        ("L-Carnitine drink", "discarded"),
        ("Monster Zero", "proposed"),
        ("Rice", "proposed"),
    ]


def test_a_delete_is_asked_for_once_and_not_for_a_meal_already_gone(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    api = user(client, db, accounts=False)
    api.assign("chat")
    meal = api.post(
        "/fitness/meals",
        {
            "items": [
                {
                    "name": "Adobo",
                    "qty": 1,
                    "unit": "serving",
                    "kcal": 400,
                    "protein": 30,
                    "carbs": 5,
                    "fat": 25,
                }
            ],
            "label": "lunch",
        },
    )
    mid = str(meal["id"])
    install(
        monkeypatch,
        say("", call("remove_item", what="meal", ids=[mid])),
        say("", call("remove_item", what="meal", ids=[mid])),
        say("The delete is waiting for your OK."),
    )
    stream(api, client, "delete that lunch")
    with Session(db_engine) as s:
        removes = s.exec(
            select(RecordCard)
            .where(RecordCard.owner_id == api.user.id)  # type: ignore[attr-defined]
            .where(RecordCard.kind == "remove")
        ).all()
        assert len(removes) == 1
        m = s.get(Meal, uuid.UUID(mid))
        assert m is not None
        m.deleted_at = m.updated_at
        s.add(m)
        s.commit()
    install(
        monkeypatch,
        say("", call("remove_item", what="meal", ids=[mid])),
        say("That meal is already gone."),
    )
    events = stream(api, client, "delete that lunch again")
    [step] = [r for r in results(events) if isinstance(r, dict)]
    assert not step["ok"]
