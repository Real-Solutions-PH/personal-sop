"""Weather logic against the prototype's own output (golden fixture)."""

import json
from dataclasses import asdict
from datetime import datetime
from pathlib import Path
from typing import Any

import pytest

from app.modules.weather import logic as W

_FILE = json.loads(
    (Path(__file__).parents[2] / "golden" / "weather-logic.json").read_text()
)
GOLDEN = _FILE["data"]
# The prototype parsed every payload at the frozen clock (its fetchedAt).
FETCHED_MS = int(
    datetime.fromisoformat(_FILE["frozenNow"].replace("Z", "+00:00")).timestamp() * 1000
)
PLACE = W.Place(name="Manila", lat=14.5995, lon=120.9842)


def _forecast(variant: int) -> W.Forecast:
    return W.parse_forecast(GOLDEN["payloads"][variant], PLACE, FETCHED_MS)


def _norm(x: Any) -> Any:
    """Compare numbers numerically (JSON 1 == 1.0) and drop None-only keys
    the prototype omits (``detail``)."""
    if isinstance(x, dict):
        return {k: _norm(v) for k, v in x.items() if not (k == "detail" and v is None)}
    if isinstance(x, list):
        return [_norm(v) for v in x]
    if isinstance(x, bool) or x is None or isinstance(x, str):
        return x
    return float(x)


CASES = GOLDEN["cases"]


@pytest.mark.parametrize("case", CASES, ids=lambda c: f"v{c['variant']}-{c['now']}")
def test_matches_prototype(case: dict[str, Any]) -> None:
    f = _forecast(case["variant"])
    scored = [W.score_hour(h) for h in f.hourly]
    assert _norm(
        [{"score": s.score, "issues": [asdict(i) for i in s.issues]} for s in scored]
    ) == _norm(case["scored"])
    assert _norm(asdict(W.outdoor_plan(f, case["now"]))) == _norm(case["plan"])
    assert asdict(W.outdoor_advice(f, "c", case["now"])) == case["advice"]["c"]
    assert asdict(W.outdoor_advice(f, "f", case["now"])) == case["advice"]["f"]
    assert float(W.rain_soon(f, case["now"])) == float(case["rainSoon"])
    assert _norm(asdict(W.current_conditions(f, case["now"]))) == _norm(case["current"])


def test_advice_covers_several_branches() -> None:
    kinds = {c["advice"]["c"]["kind"] for c in CASES}
    assert len(kinds) >= 3, kinds  # the grid must exercise the branches


def test_formatting_matches_prototype() -> None:
    for hour, text in GOLDEN["fmt"]["hours"]:
        assert W.fmt_hour(hour) == text
    for a, b, text in GOLDEN["fmt"]["ranges"]:
        assert W.fmt_range(a, b) == text
    for t, unit, text in GOLDEN["fmt"]["temps"]:
        assert W.fmt_temp(t, unit) == text


def test_garbage_numbers_read_as_zero() -> None:
    assert W._num(float("nan")) == 0 and W._num("12") == 0 and W._num(True) == 0
    assert W.js_round(2.5) == 3 and W.js_round(-2.5) == -2
