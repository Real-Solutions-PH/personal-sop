"""The mobile companion mappers' ops and Sol's ask body against the server's
schemas (``mobile/src/live/__tests__/fixtures/companion-wire.json``, written
by ``companion.test.ts``). Pure validation: no database."""

import json
from pathlib import Path
from typing import Any

import pytest

from app.modules.companion.schema import AskIn
from app.modules.sync.registry import registry

FIXTURE = (
    Path(__file__).resolve().parents[4]
    / "mobile/src/live/__tests__/fixtures/companion-wire.json"
)
WIRE: dict[str, Any] = json.loads(FIXTURE.read_text())


def _id(op: dict[str, Any]) -> str:
    return f"{op['kind']}:{op['name']}"


def test_fixture_covers_every_pushed_entity() -> None:
    assert {_id(op) for op in WIRE["ops"]} == {
        "upsert:companion",
        "upsert:tracker",
        "upsert:memory",
    }


@pytest.mark.parametrize("op", WIRE["ops"], ids=[_id(op) for op in WIRE["ops"]])
def test_op_validates_with_no_dropped_field(op: dict[str, Any]) -> None:
    entity = registry().entities[op["name"]]
    assert not entity.read_only
    model = entity.payload
    assert set(op["data"]) <= set(model.model_fields), "unknown field"
    parsed = model.model_validate(op["data"])
    assert parsed.model_fields_set == set(op["data"])


def test_creates_carry_the_required_fields() -> None:
    reg = registry()
    for op in WIRE["ops"]:
        required = reg.entities[op["name"]].create_required
        if op["kind"] == "upsert" and any(k in op["data"] for k in required):
            assert set(required) <= set(op["data"])


def test_ask_body_validates() -> None:
    (body,) = WIRE["rest"]
    assert body["model"] == "AskIn"
    parsed = AskIn.model_validate(body["data"])
    assert parsed.model_fields_set == set(body["data"])
