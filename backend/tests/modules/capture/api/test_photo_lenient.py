"""A photo logged through Log a meal is read, not refused, when the vision
model answers the way real vision models do.

Seen live (2026-10-31): a Kirkland fish-oil Supplement Facts photo sent
from Log a meal with the meal chip "Breakfast" came back as "Hmm. Couldn't
find anything to log — I couldn't read this photo". The reader's answer was
thrown away whole for one field: a label lists no protein or carbs, so the
model wrote ``null`` there (and a long assumption, and its thinking with
braces before the JSON), the strict schema refused all of it, and the
capture fell back to the caption "Breakfast", which names no food.
"""

import json

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session

from tests.modules.capture.api.helpers import (
    FakeStorage,
    card_of,
    install,
    media,
    say,
    storage,
    user,
)
from tests.modules.media.test_sniff import JPEG

__all__ = ["storage"]

FISH_OIL = {
    "name": "Kirkland Signature Fish Oil 1000 mg softgel",
    "qty": 1,
    "unit": "softgel",
    "kcal": 10,
    "protein": None,
    "carbs": None,
    "fat": 1,
    "fiber": None,
    "sat_fat": 0,
    "sugar": None,
    "sodium": 0,
    "assumption": (
        "This is a Supplement Facts panel rather than a plate of food, so the "
        "item is one softgel as the serving size printed on the label; the "
        "label lists 10 calories and 1 g total fat per softgel and no protein, "
        "carbohydrate, fiber or sugar at all, so those are left out entirely."
    ),
}


def _photo(api: object, store: FakeStorage, **extra: object) -> dict:
    mid = media(api, store, kind="image", mime="image/jpeg", data=JPEG)  # type: ignore[arg-type]
    return api.capture(source="photo", media_id=mid, **extra)  # type: ignore[attr-defined,no-any-return]


def _items(cap: dict) -> list[dict]:
    card = card_of(cap, "meal")
    return list(card["payload"]["items"])


def test_nulls_and_a_long_assumption_still_make_a_meal(
    client: TestClient,
    db: Session,
    monkeypatch: pytest.MonkeyPatch,
    storage: FakeStorage,
) -> None:
    api = user(client, db)
    api.assign("vision", vision=True)
    install(
        monkeypatch,
        say(json.dumps({"items": [FISH_OIL], "confidence": 0.8, "follow_up": None})),
    )
    cap = _photo(api, storage, hint="meal", text="Breakfast")
    assert not any(c["kind"] == "info" for c in cap["cards"]), cap["cards"]
    (item,) = _items(cap)
    assert (item["kcal"], item["fat"], item["protein"]) == (10, 1, 0)


def test_thinking_with_braces_before_the_json_is_skipped(
    client: TestClient,
    db: Session,
    monkeypatch: pytest.MonkeyPatch,
    storage: FakeStorage,
) -> None:
    api = user(client, db)
    api.assign("vision", vision=True)
    answer = (
        "<think>The panel reads {Serving Size 1 Softgel} and {Calories 10}; "
        "I should answer the JSON asked.</think>\n"
        + json.dumps({"items": [FISH_OIL], "confidence": 0.8, "follow_up": None})
    )
    install(monkeypatch, say(answer))
    cap = _photo(api, storage, hint="meal", text="Breakfast")
    (item,) = _items(cap)
    assert item["kcal"] == 10


def test_a_label_read_as_no_meal_is_read_as_a_label(
    client: TestClient,
    db: Session,
    monkeypatch: pytest.MonkeyPatch,
    storage: FakeStorage,
) -> None:
    api = user(client, db)
    api.assign("vision", vision=True)
    label = {
        "name": "Kirkland Signature Fish Oil",
        "serving": "1 softgel",
        "kcal": 10,
        "protein": None,
        "carbs": None,
        "fat": 1,
        "servings": None,
    }
    model = install(
        monkeypatch,
        say(json.dumps({"items": [], "confidence": 0.3, "follow_up": None})),
        say(json.dumps(label)),
    )
    cap = _photo(api, storage, hint="meal", text="Breakfast")
    assert len(model.seen) == 2
    (item,) = _items(cap)
    assert item["kcal"] == 10
