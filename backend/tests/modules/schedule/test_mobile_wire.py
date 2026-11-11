"""The mobile schedule mapper's payloads against the sync registry.

The jest suite ``mobile/src/live/__tests__/schedule-mapper.test.ts`` writes
every op it produces to ``schedule-wire.json``; each is validated here with
the payload model the server applies it with. Pure schema checks.
"""

import json
from collections.abc import Generator
from pathlib import Path
from typing import Any

import pytest

from app.modules.sync.registry import registry

FIXTURE = (
    Path(__file__).resolve().parents[4]
    / "mobile/src/live/__tests__/fixtures/schedule-wire.json"
)


# The suite-wide autouse fixtures provision a database; these checks need none.
@pytest.fixture(scope="session", autouse=True)
def db() -> Generator[None, None, None]:
    yield None


@pytest.fixture(scope="session", autouse=True)
def app_user_engine() -> Generator[None, None, None]:
    yield None


def _ops() -> list[dict[str, Any]]:
    ops: list[dict[str, Any]] = json.loads(FIXTURE.read_text())
    return ops


def test_fixture_covers_create_edit_and_reset() -> None:
    kinds = [(o["kind"], o.get("create")) for o in _ops()]
    assert kinds == [("upsert", True), ("upsert", False), ("delete", None)]


@pytest.mark.parametrize("op", _ops(), ids=lambda o: f"{o['kind']}:{o['name']}")
def test_op_matches_the_server_schema(op: dict[str, Any]) -> None:
    entity = registry().entities[op["name"]]
    if op["kind"] == "delete":
        return
    data = op["data"]
    assert set(data) <= set(entity.payload.model_fields), "field the server drops"
    payload = entity.payload.model_validate(data)
    if op.get("create"):
        missing = set(entity.create_required) - payload.model_fields_set
        assert not missing, f"create without {missing}"
