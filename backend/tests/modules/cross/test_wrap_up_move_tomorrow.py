"""Wrap-up "move to tomorrow" reschedules the task through tasks.public."""

from datetime import timedelta

from fastapi.testclient import TestClient
from sqlmodel import Session

from app.core.config import settings
from app.shared.day import DayClock
from tests.modules.fitness.api.helpers import ok
from tests.utils.mobile import signed_in

API = settings.API_V1_STR


def test_move_task_tomorrow(client: TestClient, db: Session) -> None:
    _, h = signed_in(db)
    today = DayClock().today()
    task = ok(
        client.post(
            f"{API}/tasks/",
            headers=h,
            json={"title": "Call bank", "due_date": today.isoformat()},
        )
    )
    action_path = f"{API}/dashboard/wrap-up/actions"
    r = client.post(
        action_path, headers=h, json={"kind": "move_task_tomorrow", "id": task["id"]}
    )
    assert r.status_code in (200, 204), r.text
    moved = ok(client.get(f"{API}/tasks/{task['id']}", headers=h))
    assert moved["due_date"] == (today + timedelta(days=1)).isoformat()
    assert moved["reschedule_count"] == 1
