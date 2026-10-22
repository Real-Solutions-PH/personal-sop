"""Task tags: kept trimmed and without repeats, editable, synced, carried to
a repeating task's next occurrence, and set by Fern."""

import uuid

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session

from app.modules.tasks.ops import clean_tags
from tests.modules.tasks.api.helpers import API, day, new_task, ok, op, push
from tests.utils.mobile import signed_in


@pytest.mark.parametrize(
    ("given", "kept"),
    [
        (["work", "Work", " errand "], ["work", "errand"]),
        (["#deep   focus"], ["deep focus"]),
        (["", "  "], []),
        (["a" * 30], ["a" * 24]),
        ([f"t{i}" for i in range(12)], [f"t{i}" for i in range(8)]),
    ],
)
def test_tags_are_kept_trimmed_and_once(given: list[str], kept: list[str]) -> None:
    assert clean_tags(given) == kept


def test_tags_on_create_edit_and_in_the_list(client: TestClient, db: Session) -> None:
    _, headers = signed_in(db)
    t = new_task(client, headers, "Deploy AWS", tags=["work", " WORK", "#coft"])
    assert t["tags"] == ["work", "coft"]
    edited = ok(
        client.patch(f"{API}/{t['id']}", headers=headers, json={"tags": ["errand"]})
    )
    assert edited["tags"] == ["errand"]
    listed = ok(client.get(f"{API}/", headers=headers))
    assert [x["tags"] for x in listed["data"] if x["id"] == t["id"]] == [["errand"]]
    # Older tasks, and ones made without tags, read as an empty list.
    assert new_task(client, headers, "Plain")["tags"] == []


def test_tags_sync_and_carry_to_the_next_occurrence(
    client: TestClient, db: Session
) -> None:
    _, headers = signed_in(db)
    tid = uuid.uuid4()
    res = push(
        client,
        headers,
        op(
            "upsert",
            "task",
            tid,
            title="Water plants",
            due_date=day(0),
            recurrence={"rule": {"kind": "daily"}, "mode": "fixed"},
            tags=["home", "Home"],
        ),
    )[0]
    assert res["status"] == "applied", res
    assert res["row"]["tags"] == ["home"]
    nxt = ok(client.post(f"{API}/{tid}/complete", headers=headers))["next"]
    assert nxt["tags"] == ["home"]
