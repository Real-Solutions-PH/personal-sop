"""The generic sync restore op runs the task's restore hook (status too)."""

import uuid

from fastapi.testclient import TestClient
from sqlmodel import Session

from app.core.config import settings
from tests.utils.mobile import signed_in

API = settings.API_V1_STR


def _push(
    client: TestClient, h: dict[str, str], op: dict[str, object]
) -> dict[str, object]:
    r = client.post(f"{API}/sync/push", headers=h, json={"ops": [op]})
    assert r.status_code == 200, r.text
    return dict(r.json()["results"][0])


def test_generic_restore_brings_a_deleted_task_back_open(
    client: TestClient, db: Session
) -> None:
    _, h = signed_in(db)
    tid = uuid.uuid4()
    created = _push(
        client,
        h,
        {
            "op_id": str(uuid.uuid4()),
            "kind": "upsert",
            "name": "task",
            "id": str(tid),
            "data": {"title": "Pay rent"},
        },
    )
    assert created["status"] == "applied"
    gone = _push(
        client,
        h,
        {"op_id": str(uuid.uuid4()), "kind": "delete", "name": "task", "id": str(tid)},
    )
    assert gone["status"] == "applied"
    back = _push(
        client,
        h,
        {
            "op_id": str(uuid.uuid4()),
            "kind": "upsert",
            "name": "task",
            "id": str(tid),
            "data": {"deleted_at": None},
        },
    )
    assert back["status"] == "applied", back
    assert back["row"]["status"] == "open"  # type: ignore[index]
    assert client.get(f"{API}/tasks/{tid}", headers=h).json()["status"] == "open"
