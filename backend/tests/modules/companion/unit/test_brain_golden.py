"""The companion's router against the prototype (``companion-brain.json``)."""

import json
from pathlib import Path
from typing import Any

import pytest

from app.modules.companion import brain

FX = json.loads(
    (
        Path(__file__).resolve().parents[3] / "golden" / "companion-brain.json"
    ).read_text()
)["data"]


def _no_ids(blocks: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [{k: v for k, v in b.items() if k != "id"} for b in blocks]


@pytest.mark.parametrize("case", FX["cases"], ids=lambda c: c["text"])
def test_route(case: dict[str, Any]) -> None:
    got = brain.route(case["text"], user_name=FX["profileName"])
    want = case["route"]
    assert got.kind == want["kind"]
    if want["kind"] == "capture":
        assert got.effect is None
        return
    assert got.text == want["text"]
    assert _no_ids(got.blocks) == _no_ids(want.get("blocks", []))
    if got.effect and got.effect.kind == "track":
        assert got.effect.tracker is not None
        t = {k: v for k, v in got.effect.tracker.items() if v is not None}
        stored = next(x for x in case["trackers"] if x["metric"] == t["metric"])
        assert t == stored
    if got.effect and got.effect.kind == "remember":
        assert got.effect.fact == case["memories"][-1]


def test_labels() -> None:
    for x in FX["labels"]:
        assert brain.metric_label(x["metric"]) == x["label"]


def test_first_name_falls_back_to_friend() -> None:
    assert brain.first_name("") == "friend"
    assert brain.route("hi", user_name="  ").text.startswith("Hey friend!")
