"""The finance payloads the mobile app's sync mappers send, against the
server's sync schemas.

The fixture is written by ``mobile/src/live/__tests__/finance.test.ts`` from
the ops its realistic store edits produce (re-run that suite after a mapper
change). Each upsert must validate against its entity's payload model and
carry no field the model would silently drop; a create must carry the
entity's ``create_required``; each action must validate against its args.
"""

import json
from pathlib import Path
from typing import Any

import pytest

from app.modules.sync.registry import registry

FIXTURE = (
    Path(__file__).resolve().parents[4]
    / "mobile/src/live/__tests__/fixtures/finance-wire.json"
)

FINANCE_ENTITIES = {
    "account",
    "category",
    "fin_record",
    "budget",
    "budget_category",
    "planned_item",
    "planned_skip",
    "planned_snooze",
    "look_back",
    "advisor_thread",
    "advisor_message",
    "finance_settings",
}


def _ops() -> list[dict[str, Any]]:
    ops: list[dict[str, Any]] = json.loads(FIXTURE.read_text())
    return ops


def test_the_sample_covers_every_finance_entity() -> None:
    sent = {op["entity"] for op in _ops() if "entity" in op}
    assert sent == FINANCE_ENTITIES
    assert FINANCE_ENTITIES <= set(registry().entities)


@pytest.mark.parametrize("op", _ops(), ids=lambda op: op.get("entity") or op["action"])
def test_mobile_payload_validates(op: dict[str, Any]) -> None:
    reg = registry()
    if "action" in op:
        reg.actions[op["action"]].args.model_validate(op["data"])
        return
    entity = reg.entities[op["entity"]]
    data: dict[str, Any] = op["data"]
    assert set(data) <= set(entity.payload.model_fields), (
        f"fields the server would drop: {set(data) - set(entity.payload.model_fields)}"
    )
    payload = entity.payload.model_validate(data)
    if op["create"]:
        missing = set(entity.create_required) - payload.model_fields_set
        assert not missing, f"a create without {missing}"
