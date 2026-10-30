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
from langchain_core.messages import (
    AIMessage,
    BaseMessage,
    HumanMessage,
    SystemMessage,
)
from sqlmodel import Session

from app.modules.companion import services
from tests.modules.capture.api.helpers import (
    Api,
    install,
    parse_agui,
    say,
    user,
)
from tests.utils.mobile import ctx_for


def tool(name: str, /, **args: Any) -> dict[str, Any]:
    # `call()` takes the tool as `name`, which these tools use as an argument.
    return {"name": name, "args": args, "id": f"call-{uuid.uuid4().hex[:8]}"}


def earlier_section(messages: list[BaseMessage]) -> str:
    system = next(m for m in messages if isinstance(m, SystemMessage))
    text = str(system.content)
    return text[text.index("WHAT YOUR EARLIER REPLIES TODAY DID") :]


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
    # What a reply did is in the system prompt, never in a reply's text.
    assert not any("[Done this turn" in w for _, w in seen)
    assert ("fern", services.ACTED_REPLY) in seen
    assert "Created habit: Fix the bed" in earlier_section(model.seen[0])
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
    assert "[Done this turn" not in str(nudge_call[-2].content)
    nudge = str(nudge_call[-1].content)
    assert nudge.startswith("Your reply says you will still")
    assert (
        "Already done in this reply (do not redo, and do not quote this list): "
        "Created habit: Fix the bed"
    ) in nudge


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


def test_a_lasting_fact_said_in_passing_is_kept_without_being_asked(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    from app.modules.companion import memory

    api = user(client, db, accounts=False)
    api.assign("chat")
    model = install(
        monkeypatch,
        say("Nice, a 4am start suits a 6am gym slot."),
        # The pass after the reply: the message read for lasting facts.
        say(
            "",
            tool(
                "remember_fact",
                fact="Works night shifts as a nurse",
                kind="profile",
            ),
        ),
        say(""),
    )
    reply = ask(api, client, "I work night shifts as a nurse, so mornings are tough")
    assert reply["text"].startswith("Nice")
    assert str(model.seen[1][0].content).startswith(services.LEARN[:40])
    with ctx_for(api.user) as ctx:
        assert [m.text for m in memory.live(ctx)] == ["Works night shifts as a nurse"]


def test_a_message_about_nothing_lasting_costs_no_extra_call(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    api = user(client, db, accounts=False)
    api.assign("chat")
    model = install(monkeypatch, say("Here's your day."))
    ask(api, client, "what's on today?")
    # No first-person words: the reply is the only model call.
    assert len(model.seen) == 1


def test_an_asked_for_memory_is_not_read_again_after_the_reply(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    api = user(client, db, accounts=False)
    api.assign("chat")
    model = install(
        monkeypatch,
        # The focused "remember" pass, then the reply.
        say("", tool("remember_fact", fact="Allergic to shrimp", kind="health")),
        say(""),
        say("Noted, no shrimp."),
    )
    ask(api, client, "remember I'm allergic to shrimp")
    assert len(model.seen) == 3
    assert not any(
        str(sent[0].content).startswith(services.LEARN[:40]) for sent in model.seen
    )


def test_fern_tags_a_task_and_retags_it(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    from sqlmodel import select

    from app.core.db import engine
    from app.modules.tasks.models import Task

    api = user(client, db, accounts=False)
    api.assign("chat")
    install(
        monkeypatch,
        say(
            "", tool("create_tasks", tasks=[{"title": "Deploy AWS", "tags": ["work"]}])
        ),
        say("Added it, tagged work."),
        say("", tool("edit_task", task="Deploy AWS", tags=["work", "coft"])),
        say("Tagged it coft too."),
    )
    ask(api, client, "add a task to deploy AWS, tag it work")
    reply = ask(api, client, "tag the deploy AWS task coft too")
    assert reply["blocks"][0]["items"][0]["ok"]

    with Session(engine) as s:
        [t] = s.exec(select(Task).where(Task.owner_id == api.user.id)).all()  # type: ignore[attr-defined]
        assert (t.title, t.tags) == ("Deploy AWS", ["work", "coft"])


def test_narration_before_a_tool_call_is_never_shown(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    """DeepSeek says its plan ("I'll check your nutrition status") in the
    answer channel before using a tool. Seen live: it streamed onto the
    screen and vanished when the answer came. The start of each model
    call's text is held back, so a plan followed by a tool call never
    reaches the app, and only the answer streams."""
    api = user(client, db, accounts=False)
    api.assign("chat")
    install(
        monkeypatch,
        say("I'll check your nutrition status first.", tool("nutrition_status")),
        say("You have 39 g of protein left."),
    )
    r = client.post(
        "/api/v1/companion/ask/stream",
        headers=api.h,
        json={"text": "how much protein do I have left?"},
    )
    events = parse_agui(r.text)
    shown = "".join(
        e["delta"] for e in events if e.get("type") == "TEXT_MESSAGE_CONTENT"
    )
    assert "nutrition status" not in shown
    assert shown == "You have 39 g of protein left."
    assert not [e for e in events if e.get("name") == "text.discard"]
    reply = events[-1]["result"]["messages"][1]
    assert reply["text"] == "You have 39 g of protein left."


def test_a_long_answer_starts_streaming_before_it_ends() -> None:
    """Held-back text is released once it is long enough to be an answer,
    and streams live from there; a long plan before a tool is still
    dropped by the app."""
    from langchain_core.messages import AIMessage

    from app.modules.companion.turn import HOLD_CHARS, TurnStream

    events: list[Any] = []
    stream = TurnStream(ctx=None, thread_id="t", run_id="r", sink=events.append)  # type: ignore[arg-type]
    stream.model_started(1)
    stream.text("x" * (HOLD_CHARS - 1))
    # Nothing shown yet (the call's step and its "thinking" event only).
    assert [e.type.value for e in events] == ["STEP_STARTED", "CUSTOM"]
    stream.text("yy")
    assert events[-1].type.value == "TEXT_MESSAGE_CONTENT"
    assert events[-1].delta == "x" * (HOLD_CHARS - 1) + "yy"
    stream.text(" more")
    assert events[-1].delta == " more"
    stream.model_finished(
        1, AIMessage(content="", tool_calls=[{"name": "t", "args": {}, "id": "1"}])
    )
    assert any(getattr(e, "name", None) == "text.discard" for e in events)
