"""Fern reads the whole chat, word for word, until a token budget drawn from
the model's context window is spent; only then does the oldest part slide
out, folded into the chat's summary so it is not lost.

Kai, 2026-11-02: "the whole chat convo is being cut offed after some number
of chats. it should be the whole chat convo until the model have full
context window then we slide that to the latest". Before, a turn sent the
chat's last 12 messages, each cut to 1,000 characters, and left out every
reply from an earlier day."""

import uuid
from datetime import timedelta
from typing import Any

import pytest
from fastapi.testclient import TestClient
from langchain_core.messages import AIMessage, BaseMessage, HumanMessage
from sqlmodel import Session

from app.core.config import settings
from app.modules.companion import services
from app.modules.companion.models import CompanionMessage, CompanionThread
from app.modules.companion.turn import TurnStream
from app.shared.context import Ctx
from app.shared.owned import utcnow
from tests.modules.capture.api.helpers import Api, install, say, user
from tests.utils.mobile import ctx_for

QUESTION = "what did we talk about?"


def _chat(
    api: Api, texts: list[str], *, start: Any = None, step: timedelta | None = None
) -> uuid.UUID:
    """A chat of ``texts``, alternating the person and Fern, oldest first,
    ending a minute ago unless ``start`` says otherwise."""
    step = step or timedelta(seconds=30)
    start = start or utcnow() - timedelta(minutes=1) - step * len(texts)
    u = api.user  # type: ignore[attr-defined]
    with ctx_for(u) as ctx:
        thread = CompanionThread(owner_id=u.id, tenant_id=u.tenant_id, title="Chat")
        ctx.session.add(thread)
        ctx.session.flush()
        for i, text in enumerate(texts):
            ctx.session.add(
                CompanionMessage(
                    owner_id=u.id,
                    tenant_id=u.tenant_id,
                    thread_id=thread.id,
                    role="me" if i % 2 == 0 else "sol",
                    text=text,
                    created_at=start + step * i,
                )
            )
        ctx.session.commit()
        return thread.id


def _ask(client: TestClient, api: Api, thread: uuid.UUID, text: str = QUESTION) -> None:
    client.post(
        "/api/v1/companion/ask/stream",
        headers=api.h,
        json={"text": text, "thread_id": str(thread)},
    )


def _convo(sent: list[BaseMessage]) -> list[str]:
    """The chat as the first call sent it: every earlier message, without
    the new question."""
    return [
        str(m.content) for m in sent[1:-1] if isinstance(m, (HumanMessage, AIMessage))
    ]


def test_a_40_message_chat_sends_all_40_word_for_word(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    api = user(client, db, accounts=False)
    api.assign("chat")
    # Longer than the old 1,000-character cut, and no two alike.
    texts = [
        (f"message {i}: " + "tell me more about the trip. " * 60).strip()
        for i in range(40)
    ]
    thread = _chat(api, texts)
    model = install(monkeypatch, say("We talked about the trip."))
    _ask(client, api, thread)
    assert _convo(model.seen[0]) == texts


def test_a_chat_over_budget_drops_its_oldest_whole_and_keeps_them_in_the_summary(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    api = user(client, db, accounts=False)
    api.assign("chat")
    texts = [
        (f"message {i}: " + "we planned the Cebu trip. " * 20).strip()
        for i in range(30)
    ]
    one = services.estimate_tokens(texts[0])
    monkeypatch.setattr(settings, "FERN_HISTORY_MAX_TOKENS", one * 10 + one // 2)
    thread = _chat(api, texts)
    model = install(
        monkeypatch,
        say("Sure."),
        say("They planned a trip to Cebu, messages 0 to 19."),
        say("Have fun."),
    )
    _ask(client, api, thread)
    sent = _convo(model.seen[0])
    # The newest that fit, each whole and in order; the 30 do not all fit.
    assert 0 < len(sent) < 30
    assert sent == texts[-len(sent) :]
    # After the reply, what slid out is folded into the chat's summary: the
    # oldest message is in it, the ones still sent are not.
    folded = str(model.seen[1][-1].content)
    assert "NEW MESSAGES" in folded
    assert "message 0:" in folded
    assert f"message {30 - len(sent)}:" not in folded
    _ask(client, api, thread, "and then?")
    system = str(model.seen[2][0].content)
    assert "EARLIER CONVERSATION" in system
    assert "They planned a trip to Cebu" in system


def test_earlier_days_are_sent_dated_and_marked_as_that_days(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    """An earlier day's reply states that day's figures; sent bare, the model
    repeated them as today's ("1 of 2 done"). It is sent word for word now,
    stamped with its day, and the prompt says TODAY wins over it."""
    api = user(client, db, accounts=False)
    api.assign("chat")
    yesterday = utcnow() - timedelta(days=1)
    thread = _chat(
        api,
        ["How did my habits go?", "You did 1 of 2 yesterday."],
        start=yesterday,
    )
    model = install(monkeypatch, say("Today you have done 2 of 2."))
    _ask(client, api, thread, "and today?")
    with ctx_for(api.user) as ctx:  # type: ignore[attr-defined]
        day = ctx.clock.day_of(yesterday).isoformat()
    sent = _convo(model.seen[0])
    assert sent == [
        f"[said {day}] How did my habits go?",
        f"[earlier reply, {day}] You did 1 of 2 yesterday.",
    ]
    assert services.EARLIER_DAYS in str(model.seen[0][0].content)
    # The day stamp is the history's, never quoted back as "your last reply".
    assert 'Your last reply ended: "[earlier' not in str(model.seen[0][0].content)


def test_a_copied_day_stamp_never_reaches_the_reply() -> None:
    out: list[Any] = []
    stream = TurnStream(
        ctx=Ctx.__new__(Ctx), thread_id="t", run_id="r", sink=out.append
    )
    stream.text("[earlier reply, 2026-11-01] You have done 2 of 2 habits today, nice.")
    stream.end_text()
    shown = "".join(getattr(e, "delta", "") for e in out)
    assert shown == " You have done 2 of 2 habits today, nice."


def test_the_budget_follows_the_models_window(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app.modules.ai_providers import public as ai

    big = services.history_budget(_resolved("deepseek-ai/DeepSeek-V4-Flash-0731"))
    assert big == settings.FERN_HISTORY_MAX_TOKENS
    # A small window leaves room for the prompt, tools and reply first.
    monkeypatch.setattr(settings, "AI_CONTEXT_WINDOW_DEFAULT", 40_000)
    small = services.history_budget(_resolved("someone/unknown-model"))
    assert small == 40_000 - services.TURN_RESERVE_TOKENS
    assert ai.context_window(_resolved("openai/gpt-oss-120b")) == 131_072


def _resolved(model: str) -> Any:
    from pydantic import SecretStr

    from app.modules.ai_providers import public as ai

    return ai.ResolvedModel(
        purpose="chat",
        provider="nebius",
        model=model,
        base_url="https://llm.example.com/v1",
        api_key=SecretStr("k"),
        credential_id=None,
        supports_vision=False,
        source="server",
    )
