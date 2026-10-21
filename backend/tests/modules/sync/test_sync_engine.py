"""The sync engine against a stand-in registry.

The real registrations arrive with each module; these tests pin the engine's
policy (receipts, LWW, tombstones, restore, rejection isolation, pull order and
truncation) on one simple table, ``identity``, through the HTTP routes.
"""

import uuid
from collections.abc import Generator
from typing import Any

import pytest
from fastapi.testclient import TestClient
from pydantic import BaseModel, Field
from sqlmodel import Session

from app.core.config import settings
from app.modules.profile.models import Identity
from app.modules.sync import registry as reg_mod
from app.modules.sync.registry import Action, Entity, Registry
from app.shared.context import Ctx
from app.shared.domain import invalid
from tests.utils.mobile import signed_in

API = settings.API_V1_STR


class IdentityIn(BaseModel):
    text: str | None = Field(default=None, min_length=1, max_length=140)
    sort_order: int | None = None


class IdentityOut(BaseModel):
    model_config = {"from_attributes": True}
    id: uuid.UUID
    text: str
    sort_order: int
    version: int


def _refuse(ctx: Ctx, args: dict[str, Any]) -> dict[str, Any]:
    del ctx
    if args["n"] < 0:
        raise invalid("negative", "Must not be negative")
    return {"double": args["n"] * 2}


class NArgs(BaseModel):
    n: int


@pytest.fixture()
def stand_in_registry(monkeypatch: pytest.MonkeyPatch) -> Generator[None, None, None]:
    reg = Registry()
    reg.entity(
        Entity(
            name="identity",
            model=Identity,
            payload=IdentityIn,
            public=IdentityOut,
            create_required=("text",),
        )
    )
    reg.action(Action(name="double", handler=_refuse, args=NArgs))
    monkeypatch.setattr(reg_mod, "_registry", reg)
    yield


def _op(
    kind: str, name: str, row_id: uuid.UUID | None = None, **data: Any
) -> dict[str, Any]:
    return {
        "op_id": str(uuid.uuid4()),
        "kind": kind,
        "name": name,
        "id": str(row_id) if row_id else None,
        "data": data,
    }


def _push(
    client: TestClient, headers: dict[str, str], *ops: dict[str, Any]
) -> list[dict[str, Any]]:
    r = client.post(f"{API}/sync/push", headers=headers, json={"ops": list(ops)})
    assert r.status_code == 200, r.text
    return list(r.json()["results"])


@pytest.mark.usefixtures("stand_in_registry")
def test_push_creates_then_replay_is_a_no_op(client: TestClient, db: Session) -> None:
    _, headers = signed_in(db)
    row_id = uuid.uuid4()
    op = _op("upsert", "identity", row_id, text="I train")
    first = _push(client, headers, op)[0]
    assert first["status"] == "applied"
    assert first["row"]["text"] == "I train"
    assert first["row"]["version"] > 0

    again = _push(client, headers, op)[0]
    assert again["replayed"] is True
    assert again["row"] == first["row"]
    pulled = client.get(f"{API}/sync/pull", headers=headers).json()
    assert [c["id"] for c in pulled["changes"]] == [str(row_id)]


@pytest.mark.usefixtures("stand_in_registry")
def test_partial_upsert_is_field_level_last_writer_wins(
    client: TestClient, db: Session
) -> None:
    _, headers = signed_in(db)
    row_id = uuid.uuid4()
    _push(client, headers, _op("upsert", "identity", row_id, text="A", sort_order=1))
    res = _push(client, headers, _op("upsert", "identity", row_id, sort_order=5))[0]
    assert res["status"] == "applied"
    assert (res["row"]["text"], res["row"]["sort_order"]) == ("A", 5)
    # A create must carry its required fields.
    missing = _push(
        client, headers, _op("upsert", "identity", uuid.uuid4(), sort_order=1)
    )[0]
    assert (missing["status"], missing["code"]) == ("rejected", "missing_fields")


@pytest.mark.usefixtures("stand_in_registry")
def test_upsert_on_server_tombstone_conflicts_and_restore_revives(
    client: TestClient, db: Session
) -> None:
    _, headers = signed_in(db)
    row_id = uuid.uuid4()
    _push(client, headers, _op("upsert", "identity", row_id, text="keep"))
    assert (
        _push(client, headers, _op("delete", "identity", row_id))[0]["status"]
        == "applied"
    )
    # deleting again is idempotent
    assert (
        _push(client, headers, _op("delete", "identity", row_id))[0]["status"]
        == "applied"
    )

    stale = _push(
        client, headers, _op("upsert", "identity", row_id, text="edited offline")
    )[0]
    assert stale["status"] == "conflict"
    assert stale["code"] == "deleted_on_server"

    restored = _push(
        client,
        headers,
        {**_op("upsert", "identity", row_id), "data": {"deleted_at": None}},
    )[0]
    assert restored["status"] == "applied"
    assert restored["row"]["text"] == "keep"


@pytest.mark.usefixtures("stand_in_registry")
def test_one_rejected_op_does_not_roll_back_its_neighbours(
    client: TestClient, db: Session
) -> None:
    _, headers = signed_in(db)
    a, b = uuid.uuid4(), uuid.uuid4()
    results = _push(
        client,
        headers,
        _op("upsert", "identity", a, text="first"),
        _op("action", "double", n=-1),
        _op("upsert", "identity", b, text=""),  # fails validation
        _op("action", "double", n=21),
        _op("upsert", "nope", uuid.uuid4(), text="x"),
    )
    assert [r["status"] for r in results] == [
        "applied",
        "rejected",
        "rejected",
        "applied",
        "rejected",
    ]
    assert results[1]["code"] == "negative"
    assert results[2]["code"] == "validation_error"
    # field locations only, never the submitted value
    assert "text" in results[2]["message"]
    assert results[3]["result"] == {"double": 42}
    assert results[4]["code"] == "unknown_entity"
    changes = client.get(f"{API}/sync/pull", headers=headers).json()["changes"]
    assert {c["id"] for c in changes} == {str(a)}


@pytest.mark.usefixtures("stand_in_registry")
def test_pull_is_ordered_paged_and_carries_tombstones(
    client: TestClient, db: Session
) -> None:
    _, headers = signed_in(db)
    ids = [uuid.uuid4() for _ in range(3)]
    for i, rid in enumerate(ids):
        _push(client, headers, _op("upsert", "identity", rid, text=f"t{i}"))
    _push(client, headers, _op("delete", "identity", ids[0]))

    page = client.get(f"{API}/sync/pull?limit=2", headers=headers).json()
    assert page["truncated"] is True
    versions = [c["version"] for c in page["changes"]]
    assert versions == sorted(versions)
    rest = client.get(
        f"{API}/sync/pull?cursor={page['cursor']}", headers=headers
    ).json()
    assert rest["truncated"] is False
    seen = page["changes"] + rest["changes"]
    # ids[0] was updated by its delete: it appears once, as a tombstone.
    assert [c["id"] for c in seen] == [str(ids[1]), str(ids[2]), str(ids[0])]
    assert seen[-1]["deleted"] is True and seen[-1]["row"] is None


@pytest.mark.usefixtures("stand_in_registry")
def test_another_users_row_is_invisible(client: TestClient, db: Session) -> None:
    _, alice = signed_in(db)
    _, bob = signed_in(db)
    row_id = uuid.uuid4()
    _push(client, alice, _op("upsert", "identity", row_id, text="alice's"))
    assert client.get(f"{API}/sync/pull", headers=bob).json()["changes"] == []
    # Bob reusing Alice's id cannot overwrite her row.
    res = _push(client, bob, _op("upsert", "identity", row_id, text="bob's"))[0]
    assert res["status"] == "rejected"
    assert res["code"] == "integrity_conflict"
    mine = client.get(f"{API}/sync/pull", headers=alice).json()["changes"]
    assert mine[0]["row"]["text"] == "alice's"
