"""The companion's AI answers: grounded in the user's records, bounded in
size, plain text, and metered per call rather than per streamed chunk.

The model is substituted only at ``ai_providers.public.model_factory`` (the
scripted model in the capture helpers)."""

import json
from collections.abc import Iterator
from typing import Any

import pytest
from fastapi.testclient import TestClient
from langchain_core.callbacks import CallbackManagerForLLMRun
from langchain_core.messages import (
    AIMessage,
    AIMessageChunk,
    BaseMessage,
    HumanMessage,
    SystemMessage,
    ToolMessage,
)
from langchain_core.outputs import ChatGenerationChunk
from sqlmodel import Session, select

from app.core.db import engine as db_engine
from app.modules.ai_providers.models import AIUsage
from app.modules.capture import agent
from app.modules.companion import services
from tests.modules.capture.api.helpers import (
    Api,
    ScriptedModel,
    call,
    install,
    say,
    user,
)


def ask(api: Api, text: str) -> dict[str, Any]:
    return dict(api.post("/companion/ask", {"text": text}))


def usage_rows(api: Api) -> list[AIUsage]:
    with Session(db_engine) as s:
        return list(
            s.exec(
                select(AIUsage).where(AIUsage.owner_id == api.user.id)  # type: ignore[attr-defined]
            ).all()
        )


def today_facts(model: ScriptedModel) -> dict[str, Any]:
    system = str(model.seen[0][0].content)
    block = system.split("TODAY (JSON")[1].split("):\n", 1)[1]
    return dict(json.loads(block.split("\n")[0]))


def tool_results(model: ScriptedModel, call_no: int) -> dict[str, Any]:
    """The tool results the model was sent on call ``call_no``, by tool name."""
    return {
        str(m.name): json.loads(str(m.content))
        for m in model.seen[call_no]
        if isinstance(m, ToolMessage)
    }


# ---------------------------------------------------------------- grounding


def test_an_empty_day_is_stated_as_empty_and_the_plan_tool_says_so(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    api = user(client, db, accounts=False)
    api.assign("chat")
    model = install(monkeypatch, say("", call("plan_day")), say("Nothing is due."))
    ask(api, "What should I focus on today?")
    system = str(model.seen[0][0].content)
    facts = today_facts(model)
    assert facts["currency"] == "PHP (₱)"
    assert facts["on_target_streak_days"] == 0
    assert facts["habits_due_today"] == [] and facts["tasks_due_today_count"] == 0
    assert "Never invent" in system and "No markdown" in system
    plan = tool_results(model, 1)["plan_day"]
    assert plan == {"shown": "plan", "items": [], "nothing_pending": True}


def test_the_plan_and_the_prompt_carry_the_users_real_items(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    api = user(client, db, accounts=False)
    api.assign("chat")
    api.post("/habits/", {"name": "Stretch"})
    api.post("/tasks/", {"title": "Pay rent", "due_date": "2020-01-01"})
    api.post("/tasks/", {"title": "Someday idea"})
    model = install(
        monkeypatch, say("", call("plan_day"), call("coach")), say("Two things.")
    )
    ask(api, "plan my day")
    system = str(model.seen[0][0].content)
    assert "Stretch" in system and "Pay rent" in system
    ring = today_facts(model)["today_ring_by_area"]
    assert ring["habits"] == {"due": 1, "done": 0}
    results = tool_results(model, 1)
    whats = {i["what"]: i["kind"] for i in results["plan_day"]["items"]}
    assert whats == {"Stretch": "habit", "Pay rent": "task"}
    assert results["plan_day"]["nothing_pending"] is False
    assert results["coach"]["on_target_streak_days"] == 0


def test_fitness_items_due_are_named_so_a_day_without_habits_is_not_empty(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    """With no habits or tasks, the ring still counts fitness items; the
    prompt must name them, or the model reports "nothing due" next to
    "1 of 2 done"."""
    api = user(client, db, accounts=False)
    api.assign("chat")
    api.post("/fitness/weigh-ins", {"weight_kg": 70})
    model = install(monkeypatch, say("Weighed in; a workout is left."))
    ask(api, "How am I doing today?")
    facts = today_facts(model)
    assert facts["habits_due_today"] == [] and facts["tasks_due_today_count"] == 0
    due = {i["item"]: i["done"] for i in facts["fitness_due_today"]}
    assert due["weigh-in"] is True
    assert due.get("workout") is False
    # Every named item is one the ring counts, and no more.
    ring = facts["today_ring_by_area"]["fitness"]
    assert ring == {"due": len(due), "done": sum(due.values())}
    assert "life_score_7_days_shown_on_today" in facts
    system = str(model.seen[0][0].content)
    assert "only when all three are empty" in system


def test_an_earlier_days_chat_is_not_sent_to_the_model(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Yesterday's reply states yesterday's facts; sent along, the model
    repeated it over today's. Only the current day's messages go out."""
    from datetime import timedelta

    from app.modules.companion.models import CompanionMessage

    api = user(client, db, accounts=False)
    api.assign("chat")
    install(monkeypatch, say("You did 1 of 2 yesterday."))
    ask(api, "How was yesterday?")
    with Session(db_engine) as s:
        for m in s.exec(
            select(CompanionMessage).where(CompanionMessage.owner_id == api.user.id)  # type: ignore[attr-defined]
        ).all():
            m.created_at = m.created_at - timedelta(days=2)
            s.add(m)
        s.commit()
    install(monkeypatch, say("Earlier today."))
    ask(api, "First question today")
    model = install(monkeypatch, say("Fine."))
    ask(api, "How am I doing today?")
    sent = " ".join(str(m.content) for m in model.seen[0][1:])
    assert "How was yesterday?" not in sent
    assert "You did 1 of 2 yesterday." not in sent
    assert "First question today" in sent and "Earlier today." in sent


# ---------------------------------------------------------------- plain text


def test_markdown_in_a_reply_is_stored_as_plain_text(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    api = user(client, db, accounts=False)
    api.assign("chat")
    install(
        monkeypatch,
        say("## Today\n\n- **Morning**: stretch\n- *Evening*: `journal`\n\n\n1. Rest"),
    )
    out = ask(api, "how should today go")
    assert out["messages"][1]["text"] == (
        "Today\n\nMorning: stretch\nEvening: journal\n\nRest"
    )


@pytest.mark.parametrize(
    ("raw", "plain"),
    [
        ("**Bold** and __this__", "Bold and this"),
        ("5 * 3 = 15", "5 * 3 = 15"),  # a lone star is not emphasis
        ("snake_case_word", "snake_case_word"),
        ("  # Heading\ntext", "Heading\ntext"),
        ("1) one\n2. two\n+ three", "one\ntwo\nthree"),
    ],
)
def test_plain_text(raw: str, plain: str) -> None:
    assert services.plain_text(raw) == plain


# ---------------------------------------------------------------- bounds


def test_steps_are_capped_and_each_call_input_stays_bounded(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A model that never stops calling tools, a long thread of long
    messages, and a turn with too many tool calls: the answer still takes at
    most MAX_STEPS calls, and each call carries at most HISTORY prior
    messages of at most HISTORY_CHARS, at most MAX_TOOL_CALLS_PER_TURN real
    results of at most MAX_TOOL_RESULT_CHARS each."""
    api = user(client, db, accounts=False)
    long = "hey " + "x" * 3990
    for _ in range(10):  # the router answers greetings: 20 stored messages
        ask(api, long)
    api.assign("chat")
    chips = [call("suggest", prompts=["a"]) for _ in range(12)]
    model = install(
        monkeypatch,
        *[say("", *chips) for _ in range(10)],  # would loop for 10 calls
    )
    ask(api, "how am I doing?")

    assert len(model.seen) == services.MAX_STEPS
    for sent in model.seen:
        assert isinstance(sent[0], SystemMessage)
        convo = [
            m
            for m in sent[1:]
            if isinstance(m, (HumanMessage, AIMessage))
            and not getattr(m, "tool_calls", None)
            and m.content != "how am I doing?"
        ]
        assert len(convo) == services.HISTORY
        assert all(len(str(m.content)) <= services.HISTORY_CHARS for m in convo)
        assert isinstance(sent[-1], (HumanMessage, ToolMessage))
    # the third call holds two tool turns, each of 12 calls: 8 ran, 4 refused
    tools = [m for m in model.seen[2] if isinstance(m, ToolMessage)]
    refused = [m for m in tools if "too_many_calls_in_one_turn" in str(m.content)]
    assert len(tools) == 24 and len(refused) == 8
    sizes = [sum(len(str(m.content)) for m in sent) for sent in model.seen]
    # system + 6 x 600 history + 24 short tool results: far below the 48k
    # characters the old 12 x 4000 history alone would send
    assert max(sizes) < 16_000, sizes
    assert [u.input_tokens for u in usage_rows(api)] == [120] * services.MAX_STEPS


def test_a_long_tool_result_is_cut() -> None:
    cut = agent._tool_content({"body": "y" * 10_000})
    assert len(cut) < agent.MAX_TOOL_RESULT_CHARS + 40
    assert cut.endswith("[cut: result too long]")
    assert agent._tool_content({"ok": 1}) == '{"ok": 1}'


# ---------------------------------------------------------------- metering


class RunningTotalModel(ScriptedModel):
    """Streams like Nebius Token Factory: every chunk repeats the running
    usage total (input, and output so far)."""

    def _stream(
        self,
        messages: list[BaseMessage],
        stop: list[str] | None = None,
        run_manager: CallbackManagerForLLMRun | None = None,
        **kwargs: Any,
    ) -> Iterator[ChatGenerationChunk]:
        msg = self._next(messages)
        words = str(msg.content).split(" ")
        for i, w in enumerate(words):
            yield ChatGenerationChunk(
                message=AIMessageChunk(
                    content=w if i == 0 else f" {w}",
                    usage_metadata={
                        "input_tokens": 7000,
                        "output_tokens": i + 1,
                        "total_tokens": 7001 + i,
                    },
                )
            )


def test_a_running_usage_total_is_metered_once_not_summed(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    from app.modules.ai_providers import public as ai_public

    api = user(client, db, accounts=False)
    api.assign("chat")
    model = RunningTotalModel(
        script=[say("one two three four five six seven eight nine ten")], seen=[]
    )
    monkeypatch.setattr(ai_public, "model_factory", lambda resolved: model)
    ask(api, "hello there friend")
    [row] = usage_rows(api)
    # summing the 10 chunks would meter 70,000 in and 55 out
    assert (row.input_tokens, row.output_tokens) == (7000, 10)
