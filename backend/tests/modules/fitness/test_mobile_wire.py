"""The fitness payloads the mobile app's sync mappers send, against the
server's sync schemas.

The fixture is written by ``mobile/src/live/__tests__/fitness.test.ts`` from
the ops its realistic store edits produce (re-run that suite after a mapper
change). Each upsert must validate against its entity's payload model and
carry no field the model would silently drop; a create must carry the
entity's ``create_required``; each action must validate against its args.
``rest_timer`` is written only by the ``fitness.rest.*`` actions, so the
sample has no upsert for it.
"""

import json
from pathlib import Path
from typing import Any

import pytest

from app.modules.sync.registry import registry

FIXTURE = (
    Path(__file__).resolve().parents[4]
    / "mobile/src/live/__tests__/fixtures/fitness-wire.json"
)

FITNESS_ENTITIES = {
    "exercise",
    "workout_template",
    "template_item",
    "workout",
    "workout_exercise",
    "workout_set",
    "weigh_in",
    "macro_target",
    "meal",
    "meal_item",
    "fitness_settings",
}

FITNESS_ACTIONS = {
    "fitness.start_workout",
    "fitness.finish_workout",
    "fitness.discard_workout",
    "fitness.toggle_set",
    "fitness.rest.start",
    "fitness.rest.adjust",
    "fitness.rest.skip",
    "fitness.confirm_meal",
    "fitness.answer_follow_up",
}


def _ops() -> list[dict[str, Any]]:
    ops: list[dict[str, Any]] = json.loads(FIXTURE.read_text())
    return ops


def test_the_sample_covers_every_fitness_entity_and_action() -> None:
    ops = _ops()
    sent = {op["entity"] for op in ops if op["kind"] == "upsert"}
    assert sent == FITNESS_ENTITIES
    assert FITNESS_ENTITIES <= set(registry().entities)
    acted = {op["name"] for op in ops if op["kind"] == "action"}
    assert acted == FITNESS_ACTIONS
    assert FITNESS_ACTIONS <= set(registry().actions)


@pytest.mark.parametrize("op", _ops(), ids=lambda op: op["name"])
def test_mobile_payload_validates(op: dict[str, Any]) -> None:
    reg = registry()
    if op["kind"] == "action":
        reg.actions[op["name"]].args.model_validate(op["data"])
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
