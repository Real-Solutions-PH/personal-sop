"""``GET /nutrition/foods``: the person's own food library, most used first,
narrowed by name, and nobody else's."""

from fastapi.testclient import TestClient
from sqlmodel import Session

from app.modules.fitness.models import FoodItem
from app.shared import owned_repo
from tests.utils.mobile import ctx_for, signed_in


def _food(ctx, name: str, key: str, uses: int) -> None:  # type: ignore[no-untyped-def]
    owned_repo.insert(
        ctx,
        FoodItem,
        {
            "name": name,
            "key": key,
            "aliases": [],
            "basis": "100g",
            "kcal": 165,
            "protein": 31,
            "carbs": 0,
            "fat": 3.6,
            "sodium": 74,
            "source": "label",
            "use_count": uses,
        },
    )
    ctx.session.commit()


def test_lists_own_foods_most_used_first(client: TestClient, db: Session) -> None:
    me, headers = signed_in(db)
    other, _ = signed_in(db)
    with ctx_for(me) as ctx:
        _food(ctx, "Chicken breast", "chicken breast", 2)
        _food(ctx, "Greek yogurt", "greek yogurt", 9)
    with ctx_for(other) as ctx:
        _food(ctx, "Someone else's rice", "someone elses rice", 50)
    r = client.get("/api/v1/nutrition/foods", headers=headers)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["count"] == 2
    assert [f["name"] for f in body["data"]] == ["Greek yogurt", "Chicken breast"]
    assert body["data"][1]["sodium"] == 74 and body["data"][1]["basis"] == "100g"

    r = client.get("/api/v1/nutrition/foods?q=chick", headers=headers)
    assert [f["name"] for f in r.json()["data"]] == ["Chicken breast"]
    assert r.json()["count"] == 1


def test_needs_sign_in(client: TestClient) -> None:
    assert client.get("/api/v1/nutrition/foods").status_code in (401, 403)
