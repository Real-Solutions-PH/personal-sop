"""Cross-module: finishing a live workout ticks every habit linked to
"any workout logged" (IA ruling X-7), and the Live bar label follows the
sets as they are ticked."""

from fastapi.testclient import TestClient
from sqlmodel import Session

from app.core.config import settings
from app.modules.profile import public as profile_public
from tests.modules.fitness.api.helpers import exercise_ids, ok
from tests.utils.mobile import ctx_for, signed_in

API = settings.API_V1_STR


def test_finish_ticks_linked_habit_once(client: TestClient, db: Session) -> None:
    user, h = signed_in(db)
    gym = ok(
        client.post(
            f"{API}/habits/",
            headers=h,
            json={"name": "Gym", "link_workout": True},
        )
    )
    other = ok(client.post(f"{API}/habits/", headers=h, json={"name": "Read"}))

    ids = exercise_ids(client, h)
    wid = ok(client.post(f"{API}/fitness/workouts/start", headers=h, json={}))[
        "workout"
    ]["id"]
    w = ok(
        client.post(
            f"{API}/fitness/workouts/{wid}/exercises",
            headers=h,
            json={"exercise_ids": [ids["Barbell Row"]]},
        )
    )
    we = w["exercises"][0]
    set_id = we["sets"][0]["id"]
    ok(
        client.post(
            f"{API}/fitness/workouts/{wid}/exercises/{we['id']}/sets/{set_id}/toggle",
            headers=h,
        )
    )
    with ctx_for(user) as ctx:
        live = profile_public.get_live(ctx)
        assert live is not None and live.label.endswith(f"1/{len(we['sets'])} sets")

    ok(client.post(f"{API}/fitness/workouts/{wid}/finish", headers=h, json={}))

    logs = ok(client.get(f"{API}/habits/{gym['id']}/logs", headers=h))["data"]
    assert [(lg["status"], lg["source"]) for lg in logs] == [("done", "workout")]
    assert ok(client.get(f"{API}/habits/{other['id']}/logs", headers=h))["data"] == []
    with ctx_for(user) as ctx:
        assert profile_public.get_live(ctx) is None
