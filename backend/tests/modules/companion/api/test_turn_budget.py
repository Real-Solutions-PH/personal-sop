"""What one Fern turn costs before the person sees a word, measured with a
simulated model.

Seen live (2026-10-30/31): replies took one to three minutes (04:48 asked,
04:51 answered). The model here stands in for DeepSeek V4 Flash on Nebius
with stated assumptions (below), so the numbers are a model of latency,
not a measurement of the provider; what IS measured is everything the
server decides: how many model calls a turn makes before and after the
reply starts, how many tokens and tool schemas each one is sent, how much
reasoning it is allowed, and how long the stream holds text back.

Run with ``-s`` to print the table.
"""

import json
import sys
import time
import uuid
from collections.abc import Iterator
from datetime import timedelta
from typing import Any

import pytest
from fastapi.testclient import TestClient
from langchain_core.messages import AIMessageChunk, BaseMessage
from langchain_core.outputs import ChatGenerationChunk
from langchain_core.utils.function_calling import convert_to_openai_tool
from sqlmodel import Session

from app.modules.ai_providers import public as ai_public
from app.modules.companion import services, turn
from app.modules.companion.models import CompanionMessage
from tests.modules.capture.api.helpers import ScriptedModel, call, say, user
from tests.utils.mobile import ctx_for

# Assumptions for the simulated provider (DeepSeek V4 Flash class on a
# hosted OpenAI-compatible endpoint). Only their product with the measured
# token counts below is "latency"; change them and the comparison holds.
BASE_S = 0.8  # request overhead and queueing, per call
PREFILL_TPS = 6_000  # input tokens read per second
DECODE_TPS = 120  # output (and thinking) tokens written per second
THINKING_TOKENS = 1_500  # thinking per call when the model is let think
# The simulated model sleeps this fraction of the time it stands for.
SCALE = 0.01


class Clock:
    """Turn time = the server's own time + the model's simulated time; the
    model sleeps only SCALE of it so the test stays fast."""

    def __init__(self) -> None:
        self.t0 = time.process_time()
        self.simulated = 0.0

    def sleep(self, seconds: float) -> None:
        time.sleep(seconds * SCALE)
        self.simulated += seconds

    def server(self) -> float:
        """CPU time the server itself spent (everything but the model). CPU,
        not wall time: the host runs other suites, and waiting for a core
        is not the server's cost. Database round trips on a local Postgres
        are mostly in it; network to a hosted one is not."""
        return time.process_time() - self.t0

    def now(self) -> float:
        return self.server() + self.simulated


def _tokens(s: str) -> int:
    return max(1, len(s) // 4)


class Sim(ScriptedModel):
    """A scripted model that records what each call was sent and sleeps
    (scaled) the time the assumptions give it."""

    # Shared with the test (Any: pydantic would copy a list field).
    log: Any
    clock: Any
    thinking: bool = True
    tools: Any = None
    shared: Any = None

    def _next(self, messages: list[BaseMessage]) -> Any:
        if str(messages[0].content).startswith("You keep a running summary"):
            return say("Summary of yesterday.")
        return self.shared.pop(0) if self.shared else say("Done.")

    def bind_tools(self, tools: Any, **kwargs: Any) -> "Sim":
        del kwargs
        return self.model_copy(update={"tools": list(tools)})

    def _stream(
        self,
        messages: list[BaseMessage],
        stop: Any = None,
        run_manager: Any = None,
        **kw: Any,
    ) -> Iterator[ChatGenerationChunk]:
        sent = sum(_tokens(str(m.content)) for m in messages)
        schemas = sum(
            _tokens(json.dumps(convert_to_openai_tool(t))) for t in self.tools or []
        )
        think = THINKING_TOKENS if self.thinking else 0
        self.log.append(
            {
                "input": sent + schemas,
                "schemas": len(self.tools or []),
                "schema_tokens": schemas,
                "system_tokens": _tokens(str(messages[0].content)),
                "think": think,
            }
        )
        self.clock.sleep(BASE_S + (sent + schemas) / PREFILL_TPS + think / DECODE_TPS)
        msg = self._next(messages)
        text = msg.content if isinstance(msg.content, str) else ""
        for w in text.split(" ") if text else []:
            self.clock.sleep(1.3 / DECODE_TPS)
            yield ChatGenerationChunk(message=AIMessageChunk(content=f"{w} "))
        yield ChatGenerationChunk(
            message=AIMessageChunk(
                content="",
                tool_call_chunks=[
                    {
                        "name": tc["name"],
                        "args": json.dumps(tc["args"]),
                        "id": tc["id"],
                        "index": i,
                    }
                    for i, tc in enumerate(msg.tool_calls)
                ],
                usage_metadata=msg.usage_metadata,
            )
        )

    def _generate(
        self, messages: Any, stop: Any = None, run_manager: Any = None, **kw: Any
    ) -> Any:
        from langchain_core.outputs import ChatGeneration, ChatResult

        sent = sum(_tokens(str(m.content)) for m in messages)
        think = THINKING_TOKENS if self.thinking else 0
        self.log.append({"input": sent, "schemas": 0, "think": think})
        self.clock.sleep(BASE_S + sent / PREFILL_TPS + think / DECODE_TPS)
        return ChatResult(generations=[ChatGeneration(message=self._next(messages))])


ANSWER = (
    "Logged your iced latte with zero-calorie sugar: about 120 kcal, 6 g protein. "
    "You have 1,240 kcal and 88 g protein left today, so a chicken rice bowl "
    "at dinner would land you right on target."
)


def _seed_history(api: Any) -> uuid.UUID:
    """Yesterday's chat: a real first message of the day folds it into the
    summary, which is one more model call."""
    thread = uuid.uuid4()
    with ctx_for(api.user) as ctx:
        services.thread_for(ctx, thread)
        yday = ctx.now - timedelta(days=1)
        for i in range(10):
            ctx.session.add(
                CompanionMessage(
                    owner_id=ctx.user_id,
                    tenant_id=ctx.tenant_id,
                    thread_id=thread,
                    role="me" if i % 2 == 0 else "sol",
                    text=f"message {i} about lunch and my macros yesterday",
                    created_at=yday + timedelta(minutes=i),
                    updated_at=yday + timedelta(minutes=i),
                )
            )
        ctx.session.commit()
    return thread


def measure(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> dict[str, Any]:
    api = user(client, db)
    # The server default, so the request options it gets are the real ones.
    api.assign("chat", model="deepseek-ai/DeepSeek-V4-Flash-0731")
    thread = _seed_history(api)
    log: list[dict[str, Any]] = []
    script = [
        say(
            "",
            call(
                "log_meal",
                description="Iced latte",
                items=[
                    {
                        "name": "iced latte",
                        "qty": 1,
                        "unit": "cup",
                        "kcal": 120,
                        "protein": 6,
                        "carbs": 12,
                        "fat": 5,
                        "grams": 350,
                    }
                ],
            ),
        ),
        say(ANSWER),
    ]

    def factory(resolved: ai_public.ResolvedModel) -> Sim:
        opts = getattr(ai_public, "speed_options", None)
        thinking = not (opts and opts(resolved).get("thinking") is False)
        return Sim(
            script=[], shared=script, seen=[], log=log, clock=clock, thinking=thinking
        )

    monkeypatch.setattr(ai_public, "model_factory", factory)
    marks: dict[str, float] = {}
    clock = Clock()

    def sink(e: Any) -> None:
        name = type(e).__name__
        if name in ("ToolCallStartEvent", "TextMessageContentEvent"):
            marks.setdefault("first_progress", clock.now())
        if name == "TextMessageContentEvent" and "first_text" not in marks:
            marks["first_text"] = clock.now()

    with ctx_for(api.user) as ctx:
        stream = turn.TurnStream(
            ctx, thread_id="t", run_id=str(uuid.uuid4()), sink=sink
        )
        services.ask(
            ctx,
            text="I had a De-Stresso iced latte, I always use zero-cal sugar there",
            stream=stream,
            thread_id=thread,
        )
    total = clock.now()
    marks["server"] = clock.server()
    return {
        "server_s": round(marks["server"], 2),
        "calls": log,
        "first_text_s": round(marks.get("first_text", total), 1),
        "first_progress_s": round(marks.get("first_progress", total), 1),
        "reply_s": round(total, 1),
        "hold_chars": turn.HOLD_CHARS,
    }


def test_a_turn_reaches_its_first_words_fast(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    m = measure(client, db, monkeypatch)
    out = sys.stdout.write
    out("\nFERN TURN BUDGET\n")
    for i, c in enumerate(m["calls"], 1):
        out(
            f"  call {i}: {c['input']:>6} input tokens ({c.get('system_tokens', 0)} "
            f"system, {c.get('schema_tokens', 0)} in {c['schemas']} tool schemas), "
            f"{c['think']:>5} thinking\n"
        )
    out(
        f"  first step line: {m['first_progress_s']} s; "
        f"first visible text: {m['first_text_s']} s; reply done: {m['reply_s']} s; "
        f"server's own time: {m['server_s']} s; hold {m['hold_chars']} chars\n"
    )
    # Before this budget (2026-11-01, same assumptions): first text 45.8 s,
    # reply done 62.4 s; four calls, all thinking, a summary call first.
    assert m["first_progress_s"] < 5
    assert m["first_text_s"] < 7
    assert m["reply_s"] < 20
