"""The food library: a food saved once (from a label, said in chat, or
imported) gives the same numbers every time a meal names it, scaled to the
amount eaten; a re-save or re-import updates it in place."""

import json
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.core.db import engine as db_engine
from app.modules.fitness import food_library as L
from app.modules.fitness.models import FoodItem, MealItem
from tests.modules.capture.api.helpers import call, install, say, user
from tests.modules.capture.api.test_photo_voice import _photo
from tests.modules.companion.api.test_fern_agent import setup_step, stream
from tests.utils.mobile import ctx_for, signed_in

__all__ = ["storage"]
from tests.modules.capture.api.helpers import FakeStorage, storage  # noqa: E402


def act(tool: str, /, **args: Any) -> dict[str, Any]:
    return {**call(tool), "args": args}


def foods_of(owner: Any) -> list[FoodItem]:
    with Session(db_engine) as s:
        return list(s.exec(select(FoodItem).where(FoodItem.owner_id == owner)).all())


def test_scaling_by_grams_pieces_and_servings(db: Session) -> None:
    user_, _ = signed_in(db)
    with ctx_for(user_) as ctx:
        rice, _ = L.save_food(
            ctx,
            L.FoodDraft(
                name="White rice, long-grain, cooked",
                kcal=130,
                protein=2.7,
                carbs=28.2,
                fat=0.3,
                basis="100g",
                aliases=["rice", "kanin"],
            ),
        )
        egg, _ = L.save_food(
            ctx,
            L.FoodDraft(
                name="Egg, whole, hard-boiled",
                kcal=78,
                protein=6.3,
                fat=5.3,
                basis="piece",
                unit_grams=50,
                aliases=["egg", "boiled egg"],
            ),
        )
        ctx.session.commit()
        # 150 g of rice: one and a half times the per-100 g values.
        assert L.scaled(rice, 150, "g") == {
            "kcal": 195.0,
            # 2.7 x 1.5 = 4.050000000000001 in floating point.
            "protein": 4.1,
            "carbs": 42.3,
            "fat": 0.4,
        }
        # Two eggs by count, and 100 g of egg by its piece weight.
        two = L.scaled(egg, 2, "pcs")
        assert two is not None and two["kcal"] == 156
        assert L.scaled(egg, 100, "g") == two
        # Cups of a per-100 g food with no unit weight cannot be scaled.
        assert L.scaled(rice, 1, "cup") is None


def test_matching_by_name_alias_and_all_words(db: Session) -> None:
    user_, _ = signed_in(db)
    with ctx_for(user_) as ctx:
        L.save_food(
            ctx,
            L.FoodDraft(
                name="Lucky Me Pancit Canton Original",
                kcal=280,
                basis="serving",
                aliases=["pancit canton"],
            ),
        )
        L.save_food(ctx, L.FoodDraft(name="Chicken breast, roasted", kcal=165))
        assert L.find_food(ctx, "pancit canton") is not None
        lucky = L.find_food(ctx, "Lucky Me pancit canton original")
        assert lucky is not None and lucky.name.startswith("Lucky")
        # Every word of the food's name was said.
        assert L.find_food(ctx, "roasted chicken breast slices") is not None
        # One shared word is not a match.
        assert L.find_food(ctx, "chicken adobo") is None


def test_saving_the_same_food_again_updates_it(db: Session) -> None:
    user_, _ = signed_in(db)
    with ctx_for(user_) as ctx:
        a, new_a = L.save_food(ctx, L.FoodDraft(name="SkyFlakes", kcal=120))
        b, new_b = L.save_food(
            ctx, L.FoodDraft(name="skyflakes", kcal=130, aliases=["crackers"])
        )
        assert (new_a, new_b) == (True, False) and a.id == b.id
        assert (b.kcal, b.aliases) == (130, ["crackers"])
        # An import keyed by its source page updates the row it made.
        c, _ = L.save_food(
            ctx,
            L.FoodDraft(name="Galunggong", kcal=110, external_ref="notion:abc"),
        )
        d, new_d = L.save_food(
            ctx,
            L.FoodDraft(
                name="Galunggong, edible portion", kcal=112, external_ref="notion:abc"
            ),
        )
        assert not new_d and c.id == d.id and d.name == "Galunggong, edible portion"


def test_fern_saves_a_food_and_the_next_meal_uses_it(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    api = user(client, db)
    api.assign("chat")
    step = setup_step(
        api,
        client,
        "the label says 280 kcal, 6g protein, 38g carbs, 12g fat per pack",
        monkeypatch,
        act(
            "save_food",
            name="Lucky Me Pancit Canton Original",
            basis="serving",
            unit_grams=80,
            kcal=280,
            protein=6,
            carbs=38,
            fat=12,
            sodium=1100,
            aliases=["pancit canton"],
            source="label",
        ),
    )
    assert step["ok"]
    assert step["summary"] == (
        "Saved in your food library: Lucky Me Pancit Canton Original · 280 kcal per serving"
    )
    [food] = foods_of(api.user.id)  # type: ignore[attr-defined]
    assert (food.source, food.verified, food.unit_grams) == ("label", True, 80)

    # The model guesses 250 kcal for the meal; the library's 280 per pack wins.
    meal = setup_step(
        api,
        client,
        "had pancit canton",
        monkeypatch,
        act(
            "log_meal",
            description="Dinner: pancit canton",
            items=[
                {
                    "name": "pancit canton",
                    "qty": 1,
                    "unit": "pack",
                    "kcal": 250,
                    "protein": 5,
                }
            ],
            confidence=0.6,
        ),
    )
    assert meal["ok"]
    if meal.get("state") == "proposed":
        api.post(f"/capture/cards/{meal['card_id']}/confirm")
    with Session(db_engine) as s:
        [it] = s.exec(select(MealItem).where(MealItem.owner_id == api.user.id)).all()  # type: ignore[attr-defined]
    assert (it.kcal, it.protein, it.sodium) == (280, 6, 1100)
    assert it.assumption == "From your food library: Lucky Me Pancit Canton Original"
    [food] = foods_of(api.user.id)  # type: ignore[attr-defined]
    assert food.use_count == 1


def test_a_label_photo_saves_the_food(
    client: TestClient,
    db: Session,
    monkeypatch: pytest.MonkeyPatch,
    storage: FakeStorage,
) -> None:
    api = user(client, db)
    api.assign("vision", vision=True)
    install(
        monkeypatch,
        say(
            json.dumps(
                {
                    "name": "SkyFlakes Crackers",
                    "serving": "1 pack (25 g)",
                    "serving_grams": 25,
                    "kcal": 130,
                    "protein": 3,
                    "carbs": 20,
                    "fat": 4,
                    "sodium": 160,
                    "servings": 1,
                }
            )
        ),
    )
    _photo(api, storage, hint="label")
    [food] = foods_of(api.user.id)  # type: ignore[attr-defined]
    assert (food.name, food.basis, food.unit_grams, food.sodium) == (
        "SkyFlakes Crackers",
        "serving",
        25,
        160,
    )
    assert food.source == "label" and food.verified


def test_find_foods_lists_what_is_saved(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    api = user(client, db)
    api.assign("chat")
    with ctx_for(api.user) as ctx:  # type: ignore[attr-defined]
        L.save_food(ctx, L.FoodDraft(name="Galunggong, edible portion", kcal=110))
        ctx.session.commit()
    install(
        monkeypatch, say("", act("find_foods", query="galunggong")), say("Found it.")
    )
    events = stream(api, client, "what's in my food library for galunggong")
    step = events[-1]["result"]["messages"][1]["blocks"][0]["items"][0]
    assert step["summary"] == "Found 1 food in your library"


def test_a_notion_row_imports_once_and_re_imports_in_place(db: Session) -> None:
    row = {
        "url": "https://app.notion.com/3fbcfeea7a5881aab145ca7ceffd595a",
        "Food": "White rice, long-grain, cooked",
        "Aliases": "rice, plain rice, kanin",
        "Basis": "per 100 g",
        "Unit grams": None,
        "State": "cooked",
        "kcal": 130,
        "Protein g": 2.69,
        "Carbs g": 28.2,
        "Fat g": 0.28,
        "Fiber g": 0.4,
        "Sat fat g": 0.07,
        "Added sugar g": 0,
        "Sodium mg": 1,
        "Source type": "USDA FDC",
        "Source URL": "https://getfoodfacts.com/food/rice-white-long-grain",
        "Notes": "1 cup = 158 g.",
        "Verified": "__YES__",
    }
    user_, _ = signed_in(db)
    with ctx_for(user_) as ctx:
        assert L.import_notion_rows(ctx, [row]) == {"added": 1, "updated": 0}
        assert L.import_notion_rows(ctx, [row | {"kcal": 131}]) == {
            "added": 0,
            "updated": 1,
        }
        [rice] = L.search_foods(ctx, "rice")
        assert (rice.kcal, rice.basis, rice.state, rice.source, rice.verified) == (
            131,
            "100g",
            "cooked",
            "usda",
            True,
        )
        assert rice.aliases == ["kanin", "plain rice", "rice"]
        assert L.find_food(ctx, "kanin") is rice
