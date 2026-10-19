"""The mobile habits mappers' payloads against the habits sync registry.

The jest suite ``mobile/src/live/__tests__/habits.test.ts`` writes every op
its store-edit scenarios produce to ``habits-wire.json``; each one is
validated here with the payload or argument model the server applies it with.
Pure schema checks: no database is touched.
"""

import json
from collections.abc import Generator
from pathlib import Path
from typing import Any

import pytest
from pydantic import BaseModel

from app.modules.sync.registry import registry

FIXTURE = (
    Path(__file__).resolve().parents[4]
    / "mobile/src/live/__tests__/fixtures/habits-wire.json"
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


def _fields(model: type[BaseModel]) -> set[str]:
    return set(model.model_fields)


def test_fixture_covers_every_habits_entity_and_action() -> None:
    ops = _ops()
    names = {o["name"] for o in ops}
    assert {
        "habit",
        "habit_pause",
        "habit_log",
        "routine",
        "routine_step",
        "habit_settings",
        "habits.run.start",
        "habits.run.done",
        "habits.run.skip",
        "habits.run.back",
        "habits.run.add_minute",
        "habits.run.toggle_pause",
        "habits.timer.start",
        "habits.timer.extend",
        "habits.timer.pause",
        "habits.timer.resume",
        "habits.timer.finish",
        "habits.timer.discard",
    } <= names


@pytest.mark.parametrize("op", _ops(), ids=lambda o: f"{o['kind']}:{o['name']}")
def test_op_matches_the_server_schema(op: dict[str, Any]) -> None:
    reg = registry()
    if op["kind"] == "action":
        action = reg.actions[op["name"]]
        assert set(op["data"]) <= _fields(action.args), "unknown argument"
        action.args.model_validate(op["data"])
        return
    entity = reg.entities[op["name"]]
    if entity.read_only:
        # Run and timer rows move only through actions; the device's only
        # row op for them is an empty create or a delete, which is refused.
        assert op["kind"] == "delete" or op["data"] == {}
        return
    if op["kind"] == "delete":
        return
    data = op["data"]
    assert set(data) <= _fields(entity.payload), "field the server would drop"
    payload = entity.payload.model_validate(data)
    if op.get("create"):
        missing = set(entity.create_required) - payload.model_fields_set
        assert not missing, f"create without {missing}"
