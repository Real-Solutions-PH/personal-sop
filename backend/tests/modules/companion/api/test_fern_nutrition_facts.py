"""Seen live on 2026-10-22: "pull up my current macro status" got "I don't
have your current macro intake data": today's food was not in Fern's facts."""

from datetime import timedelta

from fastapi.testclient import TestClient
from sqlmodel import Session

from app.modules.companion import grounding
from app.modules.fitness import foods as F
from app.modules.fitness import services as S
from tests.modules.capture.api.helpers import user
from tests.utils.mobile import ctx_for


def test_todays_intake_target_and_weight_are_in_ferns_facts(
    client: TestClient, db: Session
) -> None:
    api = user(client, db)
    with ctx_for(api.user) as ctx:  # type: ignore[attr-defined]
        S.set_macro_target(ctx=ctx, kcal=1950, protein=140, carbs=235, fat=50)
        S.log_meal(
            ctx=ctx,
            items=[
                F.ItemDraft(
                    "Inasal pecho",
                    1,
                    "piece",
                    467,
                    44.6,
                    45.1,
                    10.1,
                    sat_fat=2.3,
                    sodium=497,
                )
            ],
            eaten_at=ctx.now - timedelta(minutes=5),
            label="lunch",
        )
        S._weigh_in(ctx, kg=62.4, at=ctx.now, body_fat_pct=20.0)
        ctx.commit()
        n = grounding.snapshot(ctx)["nutrition_today"]
    assert n["meals_logged"] == 1
    assert n["eaten"] == {
        "kcal": 467,
        "protein": 44.6,
        "carbs": 45.1,
        "fat": 10.1,
        "sat_fat_g": 2.3,
        "sodium_mg": 497,
    }
    assert n["target"] == {"kcal": 1950, "protein": 140, "carbs": 235, "fat": 50}
    assert n["left"]["kcal"] == 1483 and n["left"]["protein"] == 95.4
    assert n["latest_weigh_in"]["kg"] == 62.4
