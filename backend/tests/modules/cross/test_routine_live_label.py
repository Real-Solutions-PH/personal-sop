"""The routine player's Live bar label follows the current step."""

from fastapi.testclient import TestClient
from sqlmodel import Session

from app.core.config import settings
from app.modules.profile import public as profile_public
from tests.modules.fitness.api.helpers import ok
from tests.utils.mobile import ctx_for, signed_in

API = f"{settings.API_V1_STR}/habits"


def test_live_label_tracks_the_step(client: TestClient, db: Session) -> None:
    user, h = signed_in(db)
    a = ok(client.post(f"{API}/", headers=h, json={"name": "Stretch"}))
    b = ok(client.post(f"{API}/", headers=h, json={"name": "Plank"}))
    routine = ok(
        client.post(
            f"{API}/routines",
            headers=h,
            json={
                "name": "Morning",
                "icon": "sun",
                "steps": [
                    {"habit_id": a["id"], "minutes": 5},
                    {"habit_id": b["id"], "minutes": 2},
                ],
            },
        )
    )
    state = ok(client.post(f"{API}/routines/{routine['id']}/start", headers=h))
    run_id = state["run"]["id"]

    def label() -> str:
        with ctx_for(user) as ctx:
            live = profile_public.get_live(ctx)
            assert live is not None
            return live.label

    assert label().endswith("Stretch (1/2)")
    ok(client.post(f"{API}/runs/{run_id}/done", headers=h))
    assert label().endswith("Plank (2/2)")
    ok(client.post(f"{API}/runs/{run_id}/back", headers=h))
    assert label().endswith("Stretch (1/2)")
