"""The mobile dashboard and profile mappers' payloads against the sync schemas.

``mobile/src/live/__tests__/dash.test.ts`` writes every op it produces to
``fixtures/dash-wire.json``; each one must validate against the entity's
payload model (or the action's argument model) with no field silently
dropped. Pure validation: no database.
"""

import json
from pathlib import Path
from typing import Any

import pytest

from app.modules.sync.registry import registry

FIXTURE = (
    Path(__file__).resolve().parents[4]
    / "mobile/src/live/__tests__/fixtures/dash-wire.json"
)
OPS: list[dict[str, Any]] = json.loads(FIXTURE.read_text())


def _id(op: dict[str, Any]) -> str:
    return f"{op['kind']}:{op['name']}"


def test_fixture_covers_every_mapped_entity_and_action() -> None:
    seen = {_id(op) for op in OPS}
    assert {
        "upsert:profile",
        "upsert:identity",
        "upsert:setup_skip",
        "upsert:goal",
        "upsert:review",
        "upsert:wrap_up",
        "upsert:miss_note",
        "upsert:notification",
        "upsert:share_default",
        "delete:goal",
        "delete:wrap_up",
        "delete:miss_note",
    } <= seen


@pytest.mark.parametrize("op", OPS, ids=[_id(op) for op in OPS])
def test_op_validates_with_no_dropped_field(op: dict[str, Any]) -> None:
    if op["kind"] == "delete":
        assert registry().entities[op["name"]]
        return
    reg = registry()
    if op["kind"] == "action":
        model = reg.actions[op["name"]].args
    else:
        model = reg.entities[op["name"]].payload
    assert set(op["data"]) <= set(model.model_fields), "unknown field"
    parsed = model.model_validate(op["data"])
    assert parsed.model_fields_set == set(op["data"])


def test_creates_carry_the_required_fields() -> None:
    # The first upsert of an id in the fixture is its create; later ones are
    # field edits and carry only what changed.
    reg = registry()
    seen: set[str] = set()
    creates = 0
    for op in OPS:
        if op["kind"] != "upsert" or op["id"] in seen:
            continue
        seen.add(op["id"])
        creates += 1
        required = reg.entities[op["name"]].create_required
        assert set(required) <= set(op["data"]), op["name"]
    assert creates >= 9
