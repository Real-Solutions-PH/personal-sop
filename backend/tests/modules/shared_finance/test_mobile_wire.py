"""The mobile loan mapper's actions against the sync registry.

The jest suite ``mobile/src/live/__tests__/shared-mapper.test.ts`` writes
every op it produces to ``shared-finance-wire.json``; each is validated here
with the args model the server applies it with. Pure schema checks.
"""

import json
from collections.abc import Generator
from pathlib import Path
from typing import Any

import pytest

from app.modules.sync.registry import registry

FIXTURE = (
    Path(__file__).resolve().parents[4]
    / "mobile/src/live/__tests__/fixtures/shared-finance-wire.json"
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


def test_fixture_covers_every_loan_action() -> None:
    names = {o["name"] for o in _ops()}
    assert names == {
        "finance.loan.create",
        "finance.loan.respond",
        "finance.loan.cancel",
        "finance.loan.pay",
        "finance.loan.withdraw",
        "finance.loan.decide",
        "finance.loan.cash",
    }
    assert all(o["kind"] == "action" for o in _ops())


@pytest.mark.parametrize("op", _ops(), ids=lambda o: str(o["name"]))
def test_op_matches_the_server_schema(op: dict[str, Any]) -> None:
    action = registry().actions[op["name"]]
    data = op["data"]
    assert set(data) <= set(action.args.model_fields), "field the server drops"
    action.args.model_validate(data)
