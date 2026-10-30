"""A Fern reply gives its database connection back while the model runs.

A reply can think for minutes; a turn that kept its connection checked out
across each model call starved the pool for every other request once a few
replies overlapped. The model is substituted only at
``ai_providers.public.model_factory`` (the scripted model in the capture
helpers)."""

from collections.abc import Iterator
from typing import Any

import pytest
from fastapi.testclient import TestClient
from langchain_core.messages import BaseMessage
from langchain_core.outputs import ChatGenerationChunk
from sqlmodel import Session

from app.core.db import app_engine, engine
from tests.modules.capture.api.helpers import call, install, parse_agui, say, user


def checked_out() -> int:
    if app_engine is engine:
        return engine.pool.checkedout()  # type: ignore[attr-defined, no-any-return]
    return engine.pool.checkedout() + app_engine.pool.checkedout()  # type: ignore[attr-defined, no-any-return]


def test_no_connection_is_held_while_the_model_thinks(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    api = user(client, db, accounts=False)
    api.assign("chat")
    model = install(
        monkeypatch,
        say("", call("create_tasks", tasks=[{"title": "Buy milk"}])),
        say("Added it."),
    )
    during: list[int] = []
    plain = model._stream

    def watched(
        messages: list[BaseMessage], *args: Any, **kwargs: Any
    ) -> Iterator[ChatGenerationChunk]:
        during.append(checked_out())
        yield from plain(messages, *args, **kwargs)

    monkeypatch.setattr(model, "_stream", watched)
    before = checked_out()

    r = client.post(
        "/api/v1/companion/ask/stream", headers=api.h, json={"text": "add buy milk"}
    )

    assert r.status_code == 200
    assert parse_agui(r.text)[-1]["type"] == "RUN_FINISHED"
    # Every model call (before the tool, after it, and the reply's follow-up
    # reads) ran with no connection checked out beyond what the test holds.
    assert len(during) >= 2
    assert during == [before] * len(during)
