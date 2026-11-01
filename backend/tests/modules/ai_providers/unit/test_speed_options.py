"""The thinking switch: sent to model families that have one, and dropped
for good when a provider refuses it, without failing the call."""

import json
import uuid
from typing import Any

import httpx
import pytest
from langchain_core.messages import HumanMessage
from pydantic import SecretStr

from app.core.config import settings
from app.modules.ai_providers import public


def _resolved(
    model: str, base: str = "https://llm.example.com/v1"
) -> public.ResolvedModel:
    return public.ResolvedModel(
        purpose="chat",
        provider="nebius",
        model=model,
        base_url=base,
        api_key=SecretStr("k"),
        credential_id=None,
        supports_vision=False,
        source="server",
    )


def test_families_with_a_switch_get_it() -> None:
    assert public.speed_options(_resolved("deepseek-ai/DeepSeek-V4-Flash-0731"))[
        "extra_body"
    ] == {"chat_template_kwargs": {"thinking": False}}
    assert public.speed_options(_resolved("Qwen/Qwen3.8-27B"))["extra_body"] == {
        "chat_template_kwargs": {"enable_thinking": False}
    }
    assert public.speed_options(_resolved("Qwen/Qwen3-Embedding-8B")) == {}
    assert public.speed_options(_resolved("openbmb/MiniCPM-V-4_5")) == {}


def test_thinking_stays_on_when_the_setting_says_so(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "AI_THINKING", True)
    assert public.speed_options(_resolved("deepseek-ai/DeepSeek-V4-Flash-0731")) == {}


def _server(seen: list[dict[str, Any]]) -> httpx.MockTransport:
    """An OpenAI-compatible server that refuses chat_template_kwargs."""

    def handle(req: httpx.Request) -> httpx.Response:
        body = json.loads(req.content)
        seen.append(body)
        if "chat_template_kwargs" in body:
            return httpx.Response(
                400, json={"error": {"message": "unknown field", "type": "invalid"}}
            )
        if body.get("stream"):
            chunk = {
                "id": "1",
                "object": "chat.completion.chunk",
                "created": 0,
                "model": body["model"],
                "choices": [
                    {"index": 0, "delta": {"content": "hi"}, "finish_reason": "stop"}
                ],
            }
            return httpx.Response(
                200,
                content=f"data: {json.dumps(chunk)}\n\ndata: [DONE]\n\n".encode(),
                headers={"content-type": "text/event-stream"},
            )
        return httpx.Response(
            200,
            json={
                "id": "1",
                "object": "chat.completion",
                "created": 0,
                "model": body["model"],
                "choices": [
                    {
                        "index": 0,
                        "message": {"role": "assistant", "content": "hi"},
                        "finish_reason": "stop",
                    }
                ],
                "usage": {
                    "prompt_tokens": 1,
                    "completion_tokens": 1,
                    "total_tokens": 2,
                },
            },
        )

    return httpx.MockTransport(handle)


@pytest.mark.parametrize("streamed", [False, True])
def test_a_refused_switch_is_dropped_and_the_call_answers(streamed: bool) -> None:
    seen: list[dict[str, Any]] = []
    base = f"https://llm-{uuid.uuid4().hex[:6]}.example.com/v1"
    resolved = _resolved("deepseek-ai/DeepSeek-V4-Flash-0731", base)
    model = public._chat_openai()(
        model=resolved.model,
        api_key=resolved.api_key,
        base_url=base,
        max_retries=0,
        extra_body=public.speed_options(resolved)["extra_body"],
        http_client=httpx.Client(transport=_server(seen)),
    )
    msgs = [HumanMessage("hello")]
    if streamed:
        text = "".join(str(c.content) for c in model.stream(msgs))
    else:
        text = str(model.invoke(msgs).content)
    assert text == "hi"
    assert ["chat_template_kwargs" in b for b in seen] == [True, False]
    # Never sent again to that model on that server.
    assert public.speed_options(resolved) == {}
