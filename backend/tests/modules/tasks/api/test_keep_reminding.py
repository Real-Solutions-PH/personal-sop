"""Keep reminding me (``nag_every_min``) on tasks: sync, PATCH, the bounds,
and a recurring task's next occurrence keeping it."""

import uuid

from fastapi.testclient import TestClient
from sqlmodel import Session

from tests.modules.tasks.api.helpers import API, day, new_task, ok, op, pull, push
from tests.utils.mobile import signed_in


def test_sync_create_and_pull_carry_nag_every_min(
    client: TestClient, db: Session
) -> None:
    _, headers = signed_in(db)
    tid = uuid.uuid4()
    res = push(
        client,
        headers,
        op("upsert", "task", tid, title="Take meds", due_date=day(0), nag_every_min=60),
    )
    assert res[0]["status"] == "applied", res
    rows = {c["id"]: c["row"] for c in pull(client, headers)}
    assert rows[str(tid)]["nag_every_min"] == 60
    push(client, headers, op("upsert", "task", tid, nag_every_min=None))
    rows = {c["id"]: c["row"] for c in pull(client, headers)}
    assert rows[str(tid)]["nag_every_min"] is None


def test_patch_sets_it_within_bounds(client: TestClient, db: Session) -> None:
    _, headers = signed_in(db)
    t = new_task(client, headers, "Call the clinic", due_date=day(0))
    assert t["nag_every_min"] is None
    url = f"{API}/{t['id']}"
    got = ok(client.patch(url, headers=headers, json={"nag_every_min": 30}))
    assert got["nag_every_min"] == 30
    for bad in (14, 721):
        r = client.patch(url, headers=headers, json={"nag_every_min": bad})
        assert r.status_code == 422, bad


def test_next_occurrence_keeps_reminding(client: TestClient, db: Session) -> None:
    _, headers = signed_in(db)
    t = new_task(
        client,
        headers,
        "Vitamins",
        due_date=day(0),
        recurrence={"rule": {"kind": "daily"}, "mode": "fixed"},
    )
    ok(client.patch(f"{API}/{t['id']}", headers=headers, json={"nag_every_min": 120}))
    res = ok(client.post(f"{API}/{t['id']}/complete", headers=headers))
    assert res["next"]["nag_every_min"] == 120
