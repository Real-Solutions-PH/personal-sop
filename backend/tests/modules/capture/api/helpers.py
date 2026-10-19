"""Shared calls, the scripted model and SSE parsing for the capture tests.

The ONLY substitution of the AI is ``ai_providers.public.model_factory``
(the seam ADR-0012 names): :func:`install` replaces it with a factory that
returns a :class:`ScriptedModel`, which answers each call with the next
scripted message (tool calls and/or text) and records what it was sent.
"""

import json
import uuid
from collections.abc import Iterator, Sequence
from typing import Any

import pytest
from fastapi.testclient import TestClient
from langchain_core.callbacks import CallbackManagerForLLMRun
from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.messages import AIMessage, AIMessageChunk, BaseMessage
from langchain_core.outputs import ChatGeneration, ChatGenerationChunk, ChatResult
from sqlmodel import Session

from app.core.config import settings
from app.modules.ai_providers import public as ai_public
from tests.utils.mobile import signed_in

API = settings.API_V1_STR
KEY = "sk-capture-test-key-9f8e7d6c5b4a"


def call(name: str, **args: Any) -> dict[str, Any]:
    return {"name": name, "args": args, "id": f"call-{uuid.uuid4().hex[:8]}"}


def say(
    text: str = "", *calls: dict[str, Any], tokens: tuple[int, int] = (120, 30)
) -> AIMessage:
    return AIMessage(
        content=text,
        tool_calls=list(calls),
        usage_metadata={
            "input_tokens": tokens[0],
            "output_tokens": tokens[1],
            "total_tokens": sum(tokens),
        },
    )


class ScriptedModel(BaseChatModel):
    """Answers call *n* with ``script[n]``; ``fail=True`` raises instead."""

    script: list[AIMessage]
    seen: list[list[BaseMessage]]
    fail: bool = False

    @property
    def _llm_type(self) -> str:
        return "scripted"

    def bind_tools(self, tools: Sequence[Any], **kwargs: Any) -> "ScriptedModel":
        del tools, kwargs
        return self

    def _next(self, messages: list[BaseMessage]) -> AIMessage:
        self.seen.append(list(messages))
        if self.fail:
            raise RuntimeError(f"provider exploded with key {KEY}")
        if not self.script:
            return say("Done.")
        return self.script.pop(0)

    def _generate(
        self,
        messages: list[BaseMessage],
        stop: list[str] | None = None,
        run_manager: CallbackManagerForLLMRun | None = None,
        **kwargs: Any,
    ) -> ChatResult:
        return ChatResult(generations=[ChatGeneration(message=self._next(messages))])

    def _stream(
        self,
        messages: list[BaseMessage],
        stop: list[str] | None = None,
        run_manager: CallbackManagerForLLMRun | None = None,
        **kwargs: Any,
    ) -> Iterator[ChatGenerationChunk]:
        msg = self._next(messages)
        text = msg.content if isinstance(msg.content, str) else ""
        words = text.split(" ") if text else []
        for i, w in enumerate(words):
            yield ChatGenerationChunk(
                message=AIMessageChunk(content=w if i == 0 else f" {w}")
            )
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


def install(
    monkeypatch: pytest.MonkeyPatch, *script: AIMessage, fail: bool = False
) -> ScriptedModel:
    model = ScriptedModel(script=list(script), seen=[], fail=fail)
    monkeypatch.setattr(ai_public, "model_factory", lambda resolved: model)
    return model


class Api:
    """One signed-in user. Every response text is kept so a test can assert
    something never appeared in any of them."""

    def __init__(self, client: TestClient, headers: dict[str, str]) -> None:
        self.c = client
        self.h = headers
        self.texts: list[str] = []

    def _go(self, method: str, path: str, status: int | None, **kw: Any) -> Any:
        r = self.c.request(method, f"{API}{path}", headers=self.h, **kw)
        self.texts.append(r.text)
        if status is not None:
            assert r.status_code == status, r.text
        return (
            r.json()
            if r.content
            and r.headers.get("content-type", "").startswith("application/json")
            else r
        )

    def get(self, path: str, status: int = 200, **params: Any) -> Any:
        return self._go("GET", path, status, params=params)

    def post(self, path: str, body: Any = None, status: int = 200) -> Any:
        return self._go("POST", path, status, json=body if body is not None else {})

    def patch(self, path: str, body: Any, status: int = 200) -> Any:
        return self._go("PATCH", path, status, json=body)

    def put(self, path: str, body: Any, status: int = 200) -> Any:
        return self._go("PUT", path, status, json=body)

    def delete(self, path: str, status: int = 204) -> Any:
        return self._go("DELETE", path, status)

    # ------------------------------------------------------------ capture

    def capture(self, text: str = "", status: int = 201, **extra: Any) -> Any:
        body = {"client_uuid": str(uuid.uuid4()), "text": text, **extra}
        return self.post("/capture/", body, status=status)

    def stream(
        self, text: str = "", status: int = 200, **extra: Any
    ) -> tuple[int, list[tuple[str, Any]], str]:
        body = {"client_uuid": str(uuid.uuid4()), "text": text, **extra}
        r = self.c.post(f"{API}/capture/stream", headers=self.h, json=body)
        self.texts.append(r.text)
        assert r.status_code == status, r.text
        return r.status_code, parse_sse(r.text), r.text

    # ------------------------------------------------------------ setup

    def account(self, name: str, type: str = "ewallet", opening: int = 0) -> str:
        body = {"name": name, "type": type, "opening_minor": opening}
        return str(self.post("/finance/accounts", body)["id"])

    def cats(self) -> dict[str, str]:
        rows = self.get("/finance/categories", limit=100)["data"]
        return {c["slug"]: c["id"] for c in rows if c["slug"]}

    def assign(
        self, purpose: str, *, vision: bool = False, model: str = "gpt-test"
    ) -> None:
        cred = self.post(
            "/ai/providers",
            {
                "provider": "custom",
                "api_key": KEY,
                "base_url": "https://llm.example.com/v1",
            },
            status=201,
        )
        self.put(
            f"/ai/assignments/{purpose}",
            {"credential_id": cred["id"], "model": model, "supports_vision": vision},
        )


def parse_sse(text: str) -> list[tuple[str, Any]]:
    out: list[tuple[str, Any]] = []
    for block in text.strip().split("\n\n"):
        event = None
        data: list[str] = []
        for line in block.splitlines():
            if line.startswith("event: "):
                event = line[7:]
            elif line.startswith("data: "):
                data.append(line[6:])
        if event is not None:
            out.append((event, json.loads("\n".join(data)) if data else None))
    return out


def user(client: TestClient, db: Session, *, accounts: bool = True) -> Api:
    u, headers = signed_in(db)
    api = Api(client, headers)
    api.user = u  # type: ignore[attr-defined]
    if accounts:
        api.gcash = api.account("GCash")  # type: ignore[attr-defined]
        api.bpi = api.account("BPI Savings", "bank")  # type: ignore[attr-defined]
        api.cash = api.account("Cash", "cash")  # type: ignore[attr-defined]
        api.patch("/finance/settings", {"default_account_id": api.gcash})  # type: ignore[attr-defined]
    return api


def card_of(cap: dict[str, Any], kind: str) -> dict[str, Any]:
    return next(c for c in cap["cards"] if c["kind"] == kind)


class FakeStorage:
    """Stands in for object storage behind ``media.storage.client()`` (the
    media module's one substitution point): bytes by key."""

    def __init__(self) -> None:
        self.objects: dict[str, bytes] = {}

    def get_object(self, *, Bucket: str, Key: str, **kw: Any) -> dict[str, Any]:  # noqa: N803
        import io

        del Bucket, kw
        return {"Body": io.BytesIO(self.objects[Key])}


@pytest.fixture
def storage(monkeypatch: pytest.MonkeyPatch) -> FakeStorage:
    from app.modules.media import storage as media_storage

    fake = FakeStorage()
    monkeypatch.setattr(media_storage, "client", lambda: fake)
    return fake


def media(api: Api, store: FakeStorage, *, kind: str, mime: str, data: bytes) -> str:
    """A verified ("ready") upload owned by ``api``'s user."""
    from app.modules.media.models import MediaObject
    from app.shared import owned_repo
    from tests.utils.mobile import ctx_for

    key = f"test/{uuid.uuid4()}"
    store.objects[key] = data
    with ctx_for(api.user) as ctx:  # type: ignore[attr-defined]
        row = owned_repo.insert(
            ctx,
            MediaObject,
            {
                "kind": kind,
                "storage_key": key,
                "mime": mime,
                "size_bytes": len(data),
                "state": "ready",
                "ready_at": ctx.now,
            },
        )
        ctx.session.commit()
        return str(row.id)
