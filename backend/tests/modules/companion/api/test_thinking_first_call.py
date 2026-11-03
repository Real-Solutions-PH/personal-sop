"""Fern thinks before every model call of a turn (companion/loop.py): its
plan shows as it forms, and reading the results it gathered is where a
wrong assumption gets caught. A call that thinks for too long is asked
again without thinking.

Why: with thinking off on every call (to stop one-to-three-minute replies),
a reasoning model sent nothing while it planned, and the person watched a
bare "Thinking" line. Measured on DeepSeek-V4-Flash (2026-11-02): with
thinking on, the plan's first words arrive in 1.1-1.4 s and the call takes
0.3-0.8 s longer; the long tail is cut by the cap."""

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session

from app.modules.capture import agent
from tests.modules.capture.api.helpers import call, install, parse_agui, say, user

DEEPSEEK = "deepseek-ai/DeepSeek-V4-Flash-0731"
THINK = {"chat_template_kwargs": {"thinking": True}}


def _thinking(opts: list[dict[str, object]]) -> list[bool]:
    return [o.get("extra_body") == THINK for o in opts]


def test_every_call_of_a_turn_thinks(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    api = user(client, db, accounts=False)
    api.assign("chat", model=DEEPSEEK)
    model = install(
        monkeypatch,
        say("", call("nutrition_status"), thinking="They want their macros."),
        say("You have 53 kcal left today."),
    )
    r = client.post(
        "/api/v1/companion/ask/stream", headers=api.h, json={"text": "macros?"}
    )
    evs = parse_agui(r.text)
    thought = "".join(
        e["delta"] for e in evs if e["type"] == "REASONING_MESSAGE_CONTENT"
    )
    assert thought == "They want their macros."
    # Every call thinks, the one after the tool results too.
    calls = _thinking(model.opts)
    assert len(calls) > 1 and all(calls)


def test_a_model_without_a_switch_is_asked_as_before(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    api = user(client, db, accounts=False)
    api.assign("chat")  # "gpt-test": no thinking switch
    model = install(monkeypatch, say("Hello there."))
    client.post("/api/v1/companion/ask/stream", headers=api.h, json={"text": "hi"})
    assert model.opts and all("extra_body" not in o for o in model.opts)


def test_thinking_past_the_cap_is_asked_again_without_thinking(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(agent, "THINK_CAP_SECONDS", 0.0)
    api = user(client, db, accounts=False)
    api.assign("chat", model=DEEPSEEK)
    model = install(
        monkeypatch,
        say(
            "Ignored: this answer comes after thinking past the cap, so it is never shown.",
            thinking="a very long plan that never ends",
        ),
        say("Hello there."),
    )
    r = client.post("/api/v1/companion/ask/stream", headers=api.h, json={"text": "hi"})
    evs = parse_agui(r.text)
    calls = _thinking(model.opts)
    assert calls[:2] == [True, False] and not any(calls[1:])
    # Asked again with the same messages: a retry, not a follow-up.
    assert model.seen[1] == model.seen[0]
    done = evs[-1]["result"]["messages"][1]
    assert done["text"] == "Hello there."
    # What it had thought so far stayed on screen; nothing of the cut call's
    # answer reached the reply.
    assert any(e["type"] == "REASONING_MESSAGE_CONTENT" for e in evs)
    assert "Ignored" not in r.text
