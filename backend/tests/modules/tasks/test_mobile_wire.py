"""The mobile tasks mappers' payloads against the sync registry's schemas.

``mobile/src/live/__tests__/tasks.test.ts`` writes every op it produces to
``fixtures/tasks-wire.json``; each one must validate against the entity's
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
    / "mobile/src/live/__tests__/fixtures/tasks-wire.json"
)
OPS: list[dict[str, Any]] = json.loads(FIXTURE.read_text())


def _id(op: dict[str, Any]) -> str:
    return f"{op['kind']}:{op['name']}"


def test_fixture_covers_every_mapped_entity_and_action() -> None:
    seen = {_id(op) for op in OPS}
    assert {
        "upsert:task_list",
        "upsert:task",
        "upsert:task_settings",
        "upsert:task_notif_state",
        "action:tasks.complete",
        "action:tasks.uncomplete",
        "action:tasks.restore",
    } <= seen


@pytest.mark.parametrize("op", OPS, ids=[_id(op) for op in OPS])
def test_op_validates_with_no_dropped_field(op: dict[str, Any]) -> None:
    reg = registry()
    if op["kind"] == "action":
        model = reg.actions[op["name"]].args
    else:
        model = reg.entities[op["name"]].payload
    assert set(op["data"]) <= set(model.model_fields), "unknown field"
    parsed = model.model_validate(op["data"])
    assert parsed.model_fields_set == set(op["data"])


def test_creates_carry_the_required_fields() -> None:
    reg = registry()
    for op in OPS:
        if op["kind"] != "upsert":
            continue
        required = reg.entities[op["name"]].create_required
        if any(k in op["data"] for k in required):
            assert set(required) <= set(op["data"])
