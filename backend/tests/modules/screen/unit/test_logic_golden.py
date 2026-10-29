"""The Python screen-time scores against the prototype's: every input in
``scripts/golden/screen.golden.test.ts`` replayed here, compared with what
the TypeScript produced (``tests/golden/screen-logic.json``)."""

import json
import uuid
from datetime import date
from pathlib import Path
from typing import Any

import pytest

from app.modules.screen import logic as L

DATA: dict[str, Any] = json.loads(
    (Path(__file__).parents[3] / "golden" / "screen-logic.json").read_text()
)["data"]
BUDGETS = {uuid.UUID(g["id"]): g["budgetMin"] for g in DATA["groups"]}


def test_standard_rungs_match() -> None:
    assert list(L.STANDARD_RUNGS) == DATA["standardRungs"]


def test_day_score_grid() -> None:
    assert len(DATA["dayScore"]) == 4 * 41
    for c in DATA["dayScore"]:
        assert L.day_score(c["used"], c["budget"]) == pytest.approx(c["score"]), c


@pytest.mark.parametrize(
    "case", DATA["areaRate"], ids=[c["name"] for c in DATA["areaRate"]]
)
def test_area_rate_cases(case: dict[str, Any]) -> None:
    rows = [
        (date.fromisoformat(d), uuid.UUID(g), used, closed)
        for d, g, used, closed in case["rows"]
    ]
    got = L.area_rate(rows, BUDGETS)
    if case["rate"] is None:
        assert got is None
    else:
        assert got == pytest.approx(case["rate"])


def test_every_area_case_was_replayed() -> None:
    assert len(DATA["areaRate"]) == 6
