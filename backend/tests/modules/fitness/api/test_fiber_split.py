"""Soluble and insoluble fiber: kept on a meal's items, refused when they
outweigh the item's fiber, and set as daily goals that a later save of the
macros does not reset."""

import uuid
from typing import Any

from fastapi.testclient import TestClient
from sqlmodel import Session

from app.shared.owned import utcnow
from tests.modules.fitness.api.helpers import API, ok
from tests.modules.fitness.api.test_sync_fitness import op, push
from tests.utils.mobile import signed_in

# 1 cup cooked oatmeal, USDA: 166 kcal, 5.9 g protein, 28 g carbs, 3.6 g
# fat, 4 g fiber, of which about 2 g is soluble (beta-glucan).
OATS = {
    "name": "Oatmeal",
    "qty": 1,
    "unit": "cup",
    "kcal": 166,
    "protein": 5.9,
    "carbs": 28,
    "fat": 3.6,
    "fiber": 4,
    "fiber_soluble": 2,
    "fiber_insoluble": 2,
}
MACROS = {"kcal": 2000, "protein": 150, "carbs": 200, "fat": 60}


def _log(client: TestClient, h: dict[str, str], item: dict[str, Any]) -> Any:
    """A meal and its item pushed as the app syncs them; the item row back."""
    meal = uuid.uuid4()
    res = push(
        client,
        h,
        op("upsert", "meal", meal, eaten_at=utcnow().isoformat(), label="lunch"),
        op("upsert", "meal_item", uuid.uuid4(), meal_id=str(meal), **item),
    )
    assert [r["status"] for r in res] == ["applied"] * 2, res
    return res[1]["row"]


def test_a_meal_item_keeps_its_fiber_split(client: TestClient, db: Session) -> None:
    _, h = signed_in(db)
    row = _log(client, h, OATS)
    assert (row["fiber"], row["fiber_soluble"], row["fiber_insoluble"]) == (4, 2, 2)


def test_an_item_logged_with_total_fiber_only_has_no_split(
    client: TestClient, db: Session
) -> None:
    _, h = signed_in(db)
    bare = {k: v for k, v in OATS.items() if not k.startswith("fiber_")}
    row = _log(client, h, bare)
    assert row["fiber"] == 4
    assert row["fiber_soluble"] is None and row["fiber_insoluble"] is None


def test_fiber_goals_are_kept_when_only_the_macros_change(
    client: TestClient, db: Session
) -> None:
    _, h = signed_in(db)
    ok(
        client.put(
            f"{API}/targets",
            headers=h,
            json=MACROS
            | {"fiber_g": 30, "fiber_soluble_g": 10, "fiber_insoluble_g": 20},
        )
    )
    # The macros alone, as the target sheet saves them.
    t = ok(client.put(f"{API}/targets", headers=h, json=MACROS | {"kcal": 1900}))
    assert (t["fiber_g"], t["fiber_soluble_g"], t["fiber_insoluble_g"]) == (30, 10, 20)
    # An explicit null clears a goal.
    t = ok(
        client.put(f"{API}/targets", headers=h, json=MACROS | {"fiber_soluble_g": None})
    )
    assert t["fiber_soluble_g"] is None and t["fiber_insoluble_g"] == 20


def test_a_negative_fiber_goal_is_422(client: TestClient, db: Session) -> None:
    _, h = signed_in(db)
    r = client.put(f"{API}/targets", headers=h, json=MACROS | {"fiber_soluble_g": -1})
    assert r.status_code == 422
