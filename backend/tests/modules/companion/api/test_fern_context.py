"""What Fern sees of the conversation, and finishing a many-part ask.

A reply's history carries what it did, not only what it said: a reply that
created a habit and said nothing looked, next turn, like no reply at all,
and Fern brought up an older meal instead. A reply that did one part and
promised the other ("let me add it to your morning routine") gets one
corrective pass to do the rest.
"""

import uuid
from typing import Any

import pytest
from fastapi.testclient import TestClient
from langchain_core.messages import AIMessage, BaseMessage, HumanMessage
from sqlmodel import Session

from app.modules.companion import services
from tests.modules.capture.api.helpers import (
    Api,
    install,
    parse_agui,
    say,
    user,
)


def tool(name: str, /, **args: Any) -> dict[str, Any]:
    # `call()` takes the tool as `name`, which these tools use as an argument.
    return {"name": name, "args": args, "id": f"call-{uuid.uuid4().hex[:8]}"}


def ask(api: Api, client: TestClient, text: str) -> dict[str, Any]:
    r = client.post("/api/v1/companion/ask/stream", headers=api.h, json={"text": text})
    assert r.status_code == 200
    reply: dict[str, Any] = parse_agui(r.text)[-1]["result"]["messages"][1]
    return reply


def words(messages: list[BaseMessage]) -> list[tuple[str, str]]:
    return [
        ("me" if isinstance(m, HumanMessage) else "fern", str(m.content))
        for m in messages
        if isinstance(m, HumanMessage | AIMessage)
    ]


def test_history_carries_what_a_reply_did_and_marks_one_that_failed(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    api = user(client, db, accounts=False)
    api.assign("chat")
    install(
        monkeypatch,
        say("", tool("create_habit", name="Fix the bed", icon="🛏️")),
        say(""),
    )
    ask(api, client, "add fixing the bed as a habit")
    install(monkeypatch, say(""))
    ask(api, client, "what's next today?")
    model = install(monkeypatch, say("Sure."))
    ask(api, client, "try again")

    seen = words(model.seen[0])
    assert ("fern", "[Done this turn: Created habit: Fix the bed]") in seen
    # The empty reply with nothing done reads as a failure, so "try again"
    # points at the message before it, not at an older turn.
    i = seen.index(("me", "what's next today?"))
    assert seen[i + 1] == ("fern", services.FAILED_REPLY)


def test_a_promised_second_part_gets_done_in_a_corrective_pass(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    api = user(client, db, accounts=False)
    api.assign("chat")
    model = install(
        monkeypatch,
        say("", tool("create_habit", name="Fix the bed", icon="🛏️")),
        say(
            "Created it. Meanwhile, let me add Fix the bed as the first step "
            "in your morning routine."
        ),
        say(
            "",
            tool(
                "create_routine",
                name="Morning",
                steps=[{"name": "Fix the bed", "minutes": 5}],
                time="06:00",
            ),
        ),
        say("Fix the bed is a habit and the first step of your morning."),
    )
    reply = ask(
        api,
        client,
        "add fixing the bed as a habit and make it first in my morning routine",
    )
    steps = [s["summary"] for s in reply["blocks"][0]["items"]]
    assert steps[0] == "Created habit: Fix the bed"
    assert len(steps) == 2 and "routine" in steps[1].lower()
    assert reply["text"] == "Fix the bed is a habit and the first step of your morning."
    # The corrective pass is told what is already done, so it doesn't redo it.
    nudge_call = model.seen[2]
    assert "[Done this turn: Created habit: Fix the bed]" in str(nudge_call[-2].content)
    assert str(nudge_call[-1].content).startswith("Your reply says you will still")


@pytest.mark.parametrize(
    ("answer", "expected"),
    [
        ("Done. Let me add it to your routine next.", True),
        ("I'll set it as the first step.", True),
        ("Added it. Shall I set it for tomorrow too?", False),
        ("Want me to add it to your routine?", False),
        ("Added Fix the bed as a habit.", False),
    ],
)
def test_a_promise_is_a_statement_not_an_offer(answer: str, expected: bool) -> None:
    assert services.promised(answer) is expected
