"""Tier rules, capture status and the one-line reply against the prototype
engine (``capture-engine.json``), plus the server's state machine."""

from typing import Any

import pytest

from app.modules.capture import rules
from tests.modules.capture.unit.golden import load, server_shape

FX = load("capture-engine")["data"]["cases"]


def _views(items: list[dict[str, Any]]) -> list[rules.ItemView]:
    return [rules.ItemView(i["t"], i.get("state"), i.get("tone")) for i in items]


@pytest.mark.parametrize("case", FX, ids=lambda c: f"{c['variant']}:{c['text'][:30]}")
def test_tier_for(case: dict[str, Any]) -> None:
    recs = [i for i in case["items"] if i["t"] == "record"]
    assert len(recs) == len(case["drafts"])
    st = case["settings"]
    for item, draft in zip(recs, case["drafts"], strict=True):
        d = server_shape(draft)
        dup = (item.get("warn") or "").startswith("Looks like")
        got = rules.tier_for(
            rule=d["rule"],
            payload=d["payload"],
            confirm=True if dup else d.get("confirm"),
            source="text",
            rules=st["rules"],
            money_threshold_minor=st["moneyThreshold"] * 100,
        )
        assert got == item["tier"], (case["text"], item)
        # auto cards save at once; confirm cards wait; a question waits
        if "ask" in draft:
            assert item["state"] == "needs_input"
        else:
            assert item["state"] == ("saved" if got == "auto" else "proposed")


@pytest.mark.parametrize("case", FX, ids=lambda c: f"{c['variant']}:{c['text'][:30]}")
def test_status_and_reply(case: dict[str, Any]) -> None:
    v = _views(case["items"])
    assert rules.status_of(v) == case["status"]
    assert rules.reply_text(v) == case["reply"]


def test_default_rules_match_the_prototype() -> None:
    assert rules.DEFAULT_RULES == load("capture-parse")["data"]["defaultRules"]
    assert (
        rules.DEFAULT_MONEY_THRESHOLD_MINOR
        == load("capture-parse")["data"]["moneyThreshold"] * 100
    )


TRANSITIONS = {
    ("proposed", "confirm"),
    ("proposed", "discard"),
    ("proposed", "edit"),
    ("needs_input", "answer"),
    ("needs_input", "skip"),
    ("needs_input", "discard"),
    ("needs_input", "edit"),
    ("saved", "undo"),
    ("saved", "edit"),
    ("edited", "undo"),
    ("edited", "edit"),
    ("undone", "redo"),
}


def test_state_machine_is_exactly_the_documented_transitions() -> None:
    states = ("proposed", "needs_input", "saved", "edited", "undone", "discarded")
    ops = ("confirm", "discard", "undo", "redo", "edit", "answer", "skip")
    got = {(s, o) for s in states for o in ops if rules.allowed(s, o)}
    assert got == TRANSITIONS
    assert not any(rules.allowed("discarded", o) for o in ops)


def test_photo_and_parser_flag_always_confirm() -> None:
    p = {"kind": "expense", "amount_minor": 100, "category_id": "c"}
    base: dict[str, Any] = {
        "rule": "expense",
        "payload": p,
        "rules": rules.DEFAULT_RULES,
        "money_threshold_minor": 100_000,
    }
    assert rules.tier_for(confirm=None, source="text", **base) == "auto"  # type: ignore[arg-type]
    assert rules.tier_for(confirm=None, source="photo", **base) == "confirm"  # type: ignore[arg-type]
    assert rules.tier_for(confirm=True, source="text", **base) == "confirm"  # type: ignore[arg-type]
    edge = dict(base, payload={**p, "amount_minor": 100_000})
    assert rules.tier_for(confirm=None, source="text", **edge) == "auto"  # type: ignore[arg-type]
    over = dict(base, payload={**p, "amount_minor": 100_001})
    assert rules.tier_for(confirm=None, source="text", **over) == "confirm"  # type: ignore[arg-type]
    nocat = dict(base, payload={"kind": "expense", "amount_minor": 100})
    assert rules.tier_for(confirm=None, source="text", **nocat) == "confirm"  # type: ignore[arg-type]
