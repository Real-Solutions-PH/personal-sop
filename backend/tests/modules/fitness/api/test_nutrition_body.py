"""Meals, nutrition days, macro targets and weigh-ins end to end."""

import uuid
from datetime import timedelta
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session

from app.modules.fitness import public
from app.modules.fitness.public import MealItemDraft
from app.modules.stats.public import DIRTY_KEY
from app.shared.owned import utcnow
from tests.modules.fitness.api.helpers import API, err, ok
from tests.utils.mobile import ctx_for, signed_in

RICE = {
    "name": "Steamed rice",
    "qty": 1,
    "unit": "cup",
    "kcal": 205,
    "protein": 4,
    "carbs": 45,
    "fat": 0,
}


def test_manual_meal_is_confirmed_and_counts(client: TestClient, db: Session) -> None:
    _, h = signed_in(db)
    ok(
        client.put(
            f"{API}/targets",
            headers=h,
            json={"kcal": 2000, "protein": 150, "carbs": 200, "fat": 60},
        )
    )
    m = ok(
        client.post(f"{API}/meals", headers=h, json={"items": [RICE], "label": "lunch"})
    )
    assert m["status"] == "confirmed" and m["raw_input"] == "Steamed rice"
    assert m["totals"] == {"kcal": 205, "protein": 4, "carbs": 45, "fat": 0}
    day = ok(client.get(f"{API}/nutrition/day", headers=h))
    assert day["totals"]["kcal"] == 205
    assert day["left"] == {"kcal": 1795, "protein": 146, "carbs": 155, "fat": 60}
    assert [x["id"] for x in day["meals"]] == [m["id"]]


def test_estimate_review_follow_up_and_confirm(client: TestClient, db: Session) -> None:
    _, h = signed_in(db)
    m = ok(
        client.post(f"{API}/meals/estimate", headers=h, json={"text": "rice and adobo"})
    )
    assert m["status"] == "estimated"
    # Longest alias first, as in the prototype: "adobo" before "rice".
    assert [i["name"] for i in m["items"]] == ["Chicken adobo (thigh)", "Steamed rice"]
    assert m["follow_up"] == {
        "question": "How much rice?",
        "options": ["1 cup", "1.5 cups", "2 cups"],
    }
    assert m["confidence"] == pytest.approx(0.76)
    ans = ok(
        client.post(
            f"{API}/meals/{m['id']}/follow-up", headers=h, json={"option": "2 cups"}
        )
    )
    rice = ans["items"][1]
    assert (rice["qty"], rice["kcal"], rice["assumption"]) == (
        2,
        410,
        "2 cups, you said",
    )
    assert ans["follow_up"] is None and ans["confidence"] == pytest.approx(0.86)
    done = ok(client.post(f"{API}/meals/{m['id']}/confirm", headers=h))
    assert done["status"] == "confirmed"


def test_unrecognised_meal_is_422(client: TestClient, db: Session) -> None:
    _, h = signed_in(db)
    err(
        client.post(f"{API}/meals/estimate", headers=h, json={"text": "pizza"}),
        422,
        "meal_not_recognised",
    )
    assert (
        client.post(f"{API}/meals/estimate", headers=h, json={"text": ""}).status_code
        == 422
    )


def test_item_quantity_scales_and_edits(client: TestClient, db: Session) -> None:
    _, h = signed_in(db)
    m = ok(
        client.post(
            f"{API}/meals/estimate", headers=h, json={"text": "2 eggs and coffee"}
        )
    )
    egg = next(i for i in m["items"] if i["name"] == "Fried egg")
    assert (egg["qty"], egg["kcal"]) == (2, 180)

    def egg_of(meal: dict[str, Any]) -> dict[str, Any]:
        return next(i for i in meal["items"] if i["id"] == egg["id"])

    scaled = egg_of(
        ok(
            client.patch(
                f"{API}/meals/{m['id']}/items/{egg['id']}", headers=h, json={"qty": 3}
            )
        )
    )
    assert (scaled["qty"], scaled["kcal"], scaled["protein"]) == (3, 270, 18)
    named = egg_of(
        ok(
            client.patch(
                f"{API}/meals/{m['id']}/items/{egg['id']}",
                headers=h,
                json={"name": "Boiled egg", "kcal": 210},
            )
        )
    )
    assert (named["name"], named["kcal"]) == ("Boiled egg", 210)
    assert (
        client.patch(
            f"{API}/meals/{m['id']}/items/{egg['id']}", headers=h, json={"qty": 0}
        ).status_code
        == 422
    )
    added = ok(
        client.post(
            f"{API}/meals/{m['id']}/items", headers=h, json={"food_key": "banana"}
        )
    )
    assert added["items"][-1]["name"] == "Banana (lakatan)"
    err(
        client.post(
            f"{API}/meals/{m['id']}/items", headers=h, json={"food_key": "pizza"}
        ),
        404,
        "food_not_found",
    )
    err(
        client.post(f"{API}/meals/{m['id']}/items", headers=h, json={}),
        422,
        "item_required",
    )
    custom = ok(
        client.post(
            f"{API}/meals/{m['id']}/items",
            headers=h,
            json={"item": {**RICE, "name": "Ube"}},
        )
    )
    assert custom["items"][-1]["name"] == "Ube"
    gone = ok(
        client.delete(
            f"{API}/meals/{m['id']}/items/{custom['items'][-1]['id']}", headers=h
        )
    )
    assert [i["name"] for i in gone["items"]] == [
        "3-in-1 coffee",
        "Boiled egg",
        "Banana (lakatan)",
    ]


def test_photo_queue_waits_then_estimates(client: TestClient, db: Session) -> None:
    _, h = signed_in(db)
    m = ok(client.post(f"{API}/meals/photo", headers=h, json={"hint": "tinola"}))
    assert (
        m["status"] == "pending_estimate"
        and m["items"] == []
        and m["source"] == "photo"
    )
    assert m["raw_input"] == "Photo · “tinola”"
    day = ok(client.get(f"{API}/nutrition/day", headers=h))
    assert day["pending"] == 1 and day["totals"]["kcal"] == 0
    err(
        client.post(f"{API}/meals/{m['id']}/confirm", headers=h),
        409,
        "meal_pending_estimate",
    )
    est = ok(client.post(f"{API}/meals/{m['id']}/estimate", headers=h, json={}))
    assert est["status"] == "estimated" and [i["name"] for i in est["items"]] == [
        "Chicken tinola"
    ]
    bare = ok(client.post(f"{API}/meals/photo", headers=h, json={}))
    err(
        client.post(f"{API}/meals/{bare['id']}/estimate", headers=h, json={}),
        422,
        "meal_not_recognised",
    )


def test_public_estimate_hook_fills_a_pending_photo(
    client: TestClient, db: Session
) -> None:
    user, h = signed_in(db)
    m = ok(client.post(f"{API}/meals/photo", headers=h, json={}))
    with ctx_for(user) as ctx:
        public.apply_meal_estimate(
            ctx,
            meal_id=uuid.UUID(m["id"]),
            items=[
                MealItemDraft("Pancit canton", 1, "plate", 400, 12, 60, 12, "1 plate")
            ],
            confidence=0.7,
            follow_up={"question": "Fried or boiled?", "options": ["Fried", "Boiled"]},
        )
        ctx.session.commit()
    got = ok(client.get(f"{API}/meals/{m['id']}", headers=h))
    assert got["status"] == "estimated" and got["totals"]["kcal"] == 400
    assert got["follow_up"]["question"] == "Fried or boiled?"
    ok(client.post(f"{API}/meals/{m['id']}/confirm", headers=h))
    with ctx_for(user) as ctx, pytest.raises(Exception) as exc:
        public.apply_meal_estimate(
            ctx, meal_id=uuid.UUID(m["id"]), items=[], confidence=0.5
        )
    assert exc.value.detail["code"] == "meal_confirmed"  # type: ignore[attr-defined]


@pytest.mark.xfail(
    raises=NotImplementedError,
    strict=False,
    reason="media.public is a stub until merge",
)
def test_photo_with_media_checks_the_upload(client: TestClient, db: Session) -> None:
    _, h = signed_in(db)
    r = client.post(
        f"{API}/meals/photo", headers=h, json={"photo_media_id": str(uuid.uuid4())}
    )
    err(r, 404, "media_not_found")


def test_reestimate_with_hint_and_duplicate(client: TestClient, db: Session) -> None:
    _, h = signed_in(db)
    m = ok(
        client.post(
            f"{API}/meals", headers=h, json={"items": [RICE], "raw_input": "lunch"}
        )
    )
    re = ok(
        client.post(
            f"{API}/meals/{m['id']}/estimate",
            headers=h,
            json={"hint": "2 cups rice, tinola"},
        )
    )
    assert (
        re["status"] == "estimated"
        and re["raw_input"] == "lunch · “2 cups rice, tinola”"
    )
    assert {i["name"]: i["qty"] for i in re["items"]} == {
        "Steamed rice": 2,
        "Chicken tinola": 1,
    }
    dup = ok(client.post(f"{API}/meals/{m['id']}/duplicate", headers=h, json={}))
    assert dup["id"] != m["id"] and dup["status"] == "confirmed"
    assert [i["name"] for i in dup["items"]] == [i["name"] for i in re["items"]]
    assert {i["id"] for i in dup["items"]}.isdisjoint({i["id"] for i in re["items"]})


def test_delete_restore_and_day_list(client: TestClient, db: Session) -> None:
    _, h = signed_in(db)
    yesterday = (utcnow() - timedelta(days=1)).isoformat()
    a = ok(
        client.post(
            f"{API}/meals", headers=h, json={"items": [RICE], "eaten_at": yesterday}
        )
    )
    b = ok(client.post(f"{API}/meals", headers=h, json={"items": [RICE]}))
    assert ok(client.get(f"{API}/meals", headers=h))["count"] == 2
    today = ok(client.get(f"{API}/nutrition/day", headers=h))["day"]
    assert [
        x["id"] for x in ok(client.get(f"{API}/meals?day={today}", headers=h))["data"]
    ] == [b["id"]]
    ok(client.delete(f"{API}/meals/{a['id']}", headers=h))
    err(client.get(f"{API}/meals/{a['id']}", headers=h), 404, "meal_not_found")
    assert ok(client.post(f"{API}/meals/{a['id']}/restore", headers=h))["id"] == a["id"]
    moved = ok(
        client.patch(f"{API}/meals/{b['id']}", headers=h, json={"label": "snack"})
    )
    assert moved["label"] == "snack"


def test_targets_are_versioned_by_day(client: TestClient, db: Session) -> None:
    _, h = signed_in(db)
    assert ok(client.get(f"{API}/targets", headers=h)) == {
        "current": None,
        "history": [],
    }
    ok(
        client.put(
            f"{API}/targets",
            headers=h,
            json={"kcal": 2300, "protein": 160, "carbs": 245, "fat": 72},
        )
    )
    t = ok(
        client.put(
            f"{API}/targets",
            headers=h,
            json={"kcal": 2100, "protein": 150, "carbs": 220, "fat": 70},
        )
    )
    got = ok(client.get(f"{API}/targets", headers=h))
    assert len(got["history"]) == 1 and got["current"]["id"] == t["id"]
    assert got["current"]["kcal"] == 2100
    assert (
        client.put(
            f"{API}/targets",
            headers=h,
            json={"kcal": -1, "protein": 0, "carbs": 0, "fat": 0},
        ).status_code
        == 422
    )


def test_nutrition_history_verdicts(client: TestClient, db: Session) -> None:
    _, h = signed_in(db)
    ok(
        client.put(
            f"{API}/targets",
            headers=h,
            json={"kcal": 1000, "protein": 100, "carbs": 0, "fat": 0},
        )
    )
    ok(
        client.post(
            f"{API}/meals",
            headers=h,
            json={"items": [{**RICE, "kcal": 1200, "protein": 95}]},
        )
    )
    hist = ok(client.get(f"{API}/nutrition/history?days=3", headers=h))
    today = hist["days"][-1]
    assert (today["verdict"], today["over"], today["protein_hit"]) == (
        "over",
        True,
        True,
    )
    assert hist["adherence"]["logged"] == 0  # today never counts toward adherence
    assert client.get(f"{API}/nutrition/history?days=0", headers=h).status_code == 422


def test_weigh_ins_crud_and_trend(client: TestClient, db: Session) -> None:
    _, h = signed_in(db)
    for d, kg in [(8, 80.04), (1, 79.06)]:
        ok(
            client.post(
                f"{API}/weigh-ins",
                headers=h,
                json={
                    "weight_kg": kg,
                    "measured_at": (utcnow() - timedelta(days=d)).isoformat(),
                },
            )
        )
    w = ok(
        client.post(
            f"{API}/weigh-ins",
            headers=h,
            json={"weight_kg": 78.95, "body_fat_pct": 20.04, "note": "am"},
        )
    )
    assert (w["weight_kg"], w["body_fat_pct"]) == (79.0, 20.0)
    page = ok(client.get(f"{API}/weigh-ins?limit=2", headers=h))
    assert page["count"] == 3 and page["data"][0]["id"] == w["id"]
    upd = ok(
        client.patch(f"{API}/weigh-ins/{w['id']}", headers=h, json={"weight_kg": 78.5})
    )
    assert upd["weight_kg"] == 78.5
    body = ok(client.get(f"{API}/body?days=14", headers=h))
    assert body["latest"]["id"] == w["id"] and len(body["trend"]) == 14
    assert body["weekly_rate"] is not None
    ok(client.delete(f"{API}/weigh-ins/{w['id']}", headers=h))
    assert ok(client.get(f"{API}/weigh-ins", headers=h))["count"] == 2
    ok(client.post(f"{API}/weigh-ins/{w['id']}/restore", headers=h))
    assert (
        client.post(f"{API}/weigh-ins", headers=h, json={"weight_kg": 0}).status_code
        == 422
    )
    assert (
        client.post(f"{API}/weigh-ins", headers=h, json={"weight_kg": 600}).status_code
        == 422
    )


def test_writes_mark_the_day_dirty(db: Session) -> None:
    from app.modules.fitness import services

    user, _ = signed_in(db)
    with ctx_for(user) as ctx:
        services._weigh_in(ctx, kg=70, at=None)
        marks = ctx.session.info.get(DIRTY_KEY, set())
        assert (user.id, "fitness", ctx.today) in marks
        ctx.session.rollback()


def test_another_user_cannot_touch_meals_or_weigh_ins(
    client: TestClient, db: Session
) -> None:
    _, h1 = signed_in(db)
    _, h2 = signed_in(db)
    m = ok(client.post(f"{API}/meals", headers=h1, json={"items": [RICE]}))
    w = ok(client.post(f"{API}/weigh-ins", headers=h1, json={"weight_kg": 70}))
    err(client.get(f"{API}/meals/{m['id']}", headers=h2), 404, "meal_not_found")
    err(
        client.patch(
            f"{API}/meals/{m['id']}/items/{m['items'][0]['id']}",
            headers=h2,
            json={"qty": 2},
        ),
        404,
        "meal_not_found",
    )
    err(
        client.delete(f"{API}/weigh-ins/{w['id']}", headers=h2),
        404,
        "weigh_in_not_found",
    )
    assert ok(client.get(f"{API}/meals", headers=h2))["count"] == 0


def test_public_contract(client: TestClient, db: Session) -> None:
    user, h = signed_in(db)
    with ctx_for(user) as ctx:
        draft = public.estimate_meal_text(ctx, "tapsilog")
        assert [i.name for i in draft.items] == [
            "Garlic rice (sinangag)",
            "Beef tapa",
            "Fried egg",
        ]
        assert draft.follow_up is not None
        assert public.estimate_meal_text(ctx, "pizza").items == []
        meal = public.log_meal(ctx, draft)
        assert meal.status == "estimated"
        connector = public.log_meal(
            ctx,
            public.MealDraft(
                raw="x", items=draft.items, confidence=0.9, source="connector"
            ),
        )
        assert connector.status == "confirmed"
        public.log_weigh_in(ctx, kg=81.26)
        assert public.latest_weight_kg(ctx) == 81.3
        ex = public.find_or_create_exercise(ctx, "  barbell bench press ")
        assert ex.name == "Barbell Bench Press"
        new = public.find_or_create_exercise(ctx, "Hip Thrust")
        assert public.find_or_create_exercise(ctx, "hip thrust").id == new.id
        ctx.session.commit()
    assert ok(client.get(f"{API}/meals", headers=h))["count"] == 2
