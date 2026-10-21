"""The capture parser against the prototype (``capture-parse.json``)."""

import re
from typing import Any

import pytest

from app.modules.capture import parse as P
from tests.modules.capture.unit.golden import drop_none, load, server_shape, world_from

FX = load("capture-parse")["data"]
WORLD = world_from(FX["world"])

# The server never splits a segment at a thousands separator (the prototype
# did: "salary 42,000" became "salary 42" + "000"). Those inputs are pinned by
# hand in test_parse_rulings.py.
GROUPED = re.compile(r"\d,\d{3}")


def _drafts(text: str, **ctx: Any) -> list[dict[str, Any]]:
    return [
        drop_none(d.as_dict()) for d in P.parse_capture(WORLD, text, P.ParseCtx(**ctx))
    ]


@pytest.mark.parametrize("case", FX["parse"], ids=lambda c: c["text"][:40])
def test_parse_capture(case: dict[str, Any]) -> None:
    if GROUPED.search(case["text"]) and len(case["segments"]) > 1:
        pytest.skip("server ruling, see test_parse_rulings.py")
    segs = [{"seg": s.seg, "kind": s.kind} for s in P.segment(WORLD, case["text"])]
    assert segs == case["segments"]
    assert _drafts(case["text"]) == server_shape(case["drafts"])


@pytest.mark.parametrize("case", FX["hinted"], ids=lambda c: f"{c['hint']}:{c['text']}")
def test_parse_with_hint(case: dict[str, Any]) -> None:
    assert _drafts(case["text"], hint=case["hint"]) == server_shape(case["drafts"])


def test_voice_journal_is_cleaned_and_keeps_the_transcript() -> None:
    for c in FX["voice"]:
        got = drop_none(P.journal_draft(c["text"], "voice").as_dict())
        assert got == server_shape(c["draft"])


def test_photo_meal_falls_back_to_the_default_plate() -> None:
    for c in FX["photo"]:
        d = P.meal_draft(WORLD, c["raw"], photo=True, default_plate=True)
        assert d is not None
        assert drop_none(d.as_dict()) == server_shape(c["draft"])


@pytest.mark.parametrize("case", FX["amounts"], ids=lambda c: c["s"])
def test_parse_amount(case: dict[str, Any]) -> None:
    got = P.parse_amount(case["s"])
    want = case["out"]
    if want is None:
        assert got is None
    else:
        assert got is not None
        assert (got.amount, got.usd) == (want["amount"], want["usd"])


def test_title() -> None:
    for c in FX["titles"]:
        assert P.title(c["s"]) == c["out"]
