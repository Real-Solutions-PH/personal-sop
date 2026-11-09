"""The answer reaches the person whole, and every step reads as words.

Kai, 2026-11-09: asked whether to train fewer days and walk more, Fern's
only reply was "Answer's above: keep lifting, walk more." with nothing
above it. The answer had been written beside a tool call (``suggest``),
and only the last model call's text was kept as the reply. The steps list
under it started with the raw tool name "todo".
"""

import uuid
from types import SimpleNamespace
from typing import Any

import pytest
from fastapi.testclient import TestClient
from langchain_core.messages import AIMessage
from sqlmodel import Session

from app.modules.companion import services
from app.modules.companion.turn import (
    GENERIC_DONE,
    GENERIC_RUNNING,
    RUNNING,
    TurnStream,
    outcome,
    running_label,
)
from app.shared.currency import currency
from tests.modules.capture.api.helpers import install, parse_agui, say, user

ASK = "should i reduce my workout days and instead invest more on walking?"
ANSWER = (
    "Keep your lifting days. Your workouts have held steady and your weight "
    "is trending the way you want, so cutting sessions would trade strength "
    "for little. Add walking on top instead: it is easy to recover from and "
    "your walking habit is the one that slips most."
)
POINTER = "Answer's above: keep lifting, walk more. Both walks today are still open."


def tool(name: str, /, **args: Any) -> dict[str, Any]:
    return {"name": name, "args": args, "id": f"call-{uuid.uuid4().hex[:8]}"}


def _gather() -> list[AIMessage]:
    return [
        say("", tool("todo", steps=["Read workouts, habits, weight", "Answer"])),
        say(
            "",
            tool("query_records", area="workouts", days=30),
            tool("query_records", area="habits", days=30),
            tool("query_records", area="weight", days=30),
            tool("stats_overview"),
        ),
    ]


def _ask(client: TestClient, api: Any) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    r = client.post("/api/v1/companion/ask/stream", headers=api.h, json={"text": ASK})
    events = parse_agui(r.text)
    return events, events[-1]["result"]["messages"][1]


def test_an_answer_written_beside_suggest_is_the_reply(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The recorded turn: gather, answer beside ``suggest``, then point
    back. The answer streams, is stored, and survives a reload."""
    api = user(client, db, accounts=False)
    api.assign("chat")
    install(
        monkeypatch,
        *_gather(),
        say(ANSWER, tool("suggest", prompts=["How many walks a week?"])),
        say(POINTER),
    )
    events, reply = _ask(client, api)
    # Never taken back on the phone: the answer stays on screen.
    assert not [e for e in events if e.get("name") == "text.discard"]
    shown = "".join(
        e["delta"] for e in events if e.get("type") == "TEXT_MESSAGE_CONTENT"
    )
    assert ANSWER in shown
    assert ANSWER in reply["text"]
    assert "above" not in reply["text"].lower()
    # A reload reads the stored reply: the answer is still there.
    stored = api.get("/companion/messages")["data"]
    sol = next(m for m in stored if m["id"] == reply["id"])
    assert ANSWER in sol["text"]
    steps = next(b for b in sol["blocks"] if b["t"] == "steps")["items"]
    texts = [s["summary"] or s["label"] for s in steps]
    assert texts[0] == "Planned the steps"
    assert "todo" not in texts
    assert "Suggested next questions" in texts


def test_an_answer_written_beside_a_read_comes_back_when_pointed_to(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The answer written beside a read (taken for narration and dropped)
    and a last call that points back to it: the answer comes back, the
    pointer goes."""
    api = user(client, db, accounts=False)
    api.assign("chat")
    install(
        monkeypatch,
        *_gather(),
        say(ANSWER, tool("query_records", area="habits", days=1)),
        say(POINTER),
    )
    _, reply = _ask(client, api)
    assert reply["text"].startswith(ANSWER)
    assert "above" not in reply["text"].lower()
    assert "Keep lifting, walk more." in reply["text"]


def test_a_short_plan_before_a_tool_is_still_dropped(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Narration before a read stays out of the reply (only ``suggest``
    keeps its text), and a reply that does not point back is untouched."""
    api = user(client, db, accounts=False)
    api.assign("chat")
    install(
        monkeypatch,
        say(
            "Let me check your workouts first.", tool("query_records", area="workouts")
        ),
        say(ANSWER),
    )
    _, reply = _ask(client, api)
    assert reply["text"] == ANSWER


# ---------------------------------------------------------------- units


def test_restore_takes_back_the_latest_answer_and_drops_the_pointer() -> None:
    plan = "Let me look at your records."
    out = services.restore_pointed_back(POINTER, [plan, ANSWER])
    assert (
        out == f"{ANSWER}\n\nKeep lifting, walk more. Both walks today are still open."
    )
    # Nothing long enough to be the answer: the pointer still goes.
    assert services.restore_pointed_back(POINTER, [plan]) == (
        "Keep lifting, walk more. Both walks today are still open."
    )
    # A pointer mid-reply goes as a sentence.
    assert (
        services.restore_pointed_back("Walk more. See above for why.", [ANSWER])
        == f"{ANSWER}\n\nWalk more."
    )


@pytest.mark.parametrize(
    "text",
    [
        "Answer's above: keep lifting.",
        "The answer is above.",
        "As I said above, walk more.",
        "See above.",
    ],
)
def test_pointing_back_is_caught(text: str) -> None:
    assert services.points_back(text)


@pytest.mark.parametrize(
    "text",
    [
        "Fat is above target by 5 g.",
        "You stayed above 8,000 steps all week.",
        "Protein is just above where you aimed.",
    ],
)
def test_above_as_a_figure_is_not_a_pointer(text: str) -> None:
    assert not services.points_back(text)


def test_a_suggest_round_keeps_its_text_and_a_read_round_does_not() -> None:
    events: list[Any] = []
    stream = TurnStream(ctx=None, thread_id="t", run_id="r", sink=events.append)  # type: ignore[arg-type]
    stream.model_started(1)
    stream.text("Checking.")
    stream.model_finished(
        1,
        AIMessage(
            content="Checking.",
            tool_calls=[{"name": "query_records", "args": {}, "id": "1"}],
        ),
    )
    stream.model_started(2)
    stream.text(ANSWER)
    stream.model_finished(
        2,
        AIMessage(
            content=ANSWER, tool_calls=[{"name": "suggest", "args": {}, "id": "2"}]
        ),
    )
    assert not any(getattr(e, "name", None) == "text.discard" for e in events)
    assert stream.unshown == ["Checking."]
    assert stream.whole("") == ANSWER
    # Joined once: the next run starts empty.
    assert stream.whole("More.") == "More."


def test_every_step_reads_as_words() -> None:
    """Fails closed: a tool with no sentence written for it gets a generic
    one, never its own identifier (a step read "todo")."""
    assert running_label("brand_new_tool") == GENERIC_RUNNING
    ok, said = outcome(None, "brand_new_tool", {}, {})  # type: ignore[arg-type]
    assert (ok, said) == (True, GENERIC_DONE)
    assert outcome(None, "todo", {"steps": ["a"]}, {"plan": ["a"]})[1] == (  # type: ignore[arg-type]
        "Planned the steps"
    )
    ctx = SimpleNamespace(currency=currency("PHP"))
    for name in RUNNING:
        if name in ("confirm_pending", "discard_pending"):
            continue
        said = outcome(ctx, name, {}, {})[1]  # type: ignore[arg-type]
        assert said != name and said != name.replace("_", " "), name
        assert "_" not in said, name
